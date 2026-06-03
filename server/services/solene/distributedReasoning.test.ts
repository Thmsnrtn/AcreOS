/**
 * Tests for Solene distributed-reasoning service (Phase B L2.7).
 *
 * Coverage:
 *  - openSession happy path
 *  - openSession validates strategy + count
 *  - recordContribution default weight = 1 / expectedSubDispatchCount
 *  - recordContribution honors explicit weight
 *  - synthesizeSession on 'open' → closes + writes synthesis fields
 *  - synthesizeSession on 'closed' → throws
 *  - abandonSession sets status='abandoned' + final_conclusion='abandoned'
 *  - weightedAggregate math correctness (incl. degenerate cases)
 *  - buildSynthesizerPrompt includes all contributions
 *  - getSessionWithContributions returns joined shape
 *  - listOpenSessions filter
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

interface SessionRow {
  id: number;
  openedAt: Date;
  closedAt: Date | null;
  openedByAgentRole: string;
  topic: string;
  problemStatement: string;
  decompositionStrategy: string;
  expectedSubDispatchCount: number;
  status: string;
  synthesisOutput: string | null;
  finalConclusion: string | null;
  finalConfidence: string | null;
}

interface ContribRow {
  id: number;
  sessionId: number;
  contributingDispatchId: number | null;
  contributorAgentRole: string;
  sliceDescription: string;
  contributionText: string;
  contributedAt: Date;
  weight: string | null;
}

const SESSIONS: SessionRow[] = [];
const CONTRIBS: ContribRow[] = [];
let nextSessionId = 1;
let nextContribId = 1;

type WhereTag =
  | { kind: "session-by-id"; id: number }
  | { kind: "session-status"; status: string }
  | { kind: "contrib-session"; sessionId: number };

function matchSession(row: SessionRow, clause: WhereTag): boolean {
  switch (clause.kind) {
    case "session-by-id":
      return row.id === clause.id;
    case "session-status":
      return row.status === clause.status;
    default:
      return false;
  }
}

function matchContrib(row: ContribRow, clause: WhereTag): boolean {
  if (clause.kind === "contrib-session") return row.sessionId === clause.sessionId;
  return false;
}

vi.mock("../../db", () => {
  const db = {
    insert: (table: any) => ({
      values: (row: any) => ({
        returning: async (_cols: any) => {
          const now = new Date();
          if (table?.__name === "sessions") {
            const created: SessionRow = {
              id: nextSessionId++,
              openedAt: now,
              closedAt: null,
              openedByAgentRole: row.openedByAgentRole,
              topic: row.topic,
              problemStatement: row.problemStatement,
              decompositionStrategy: row.decompositionStrategy,
              expectedSubDispatchCount: row.expectedSubDispatchCount,
              status: row.status ?? "open",
              synthesisOutput: null,
              finalConclusion: null,
              finalConfidence: null,
            };
            SESSIONS.push(created);
            return [{ id: created.id }];
          }
          if (table?.__name === "contributions") {
            const created: ContribRow = {
              id: nextContribId++,
              sessionId: row.sessionId,
              contributingDispatchId: row.contributingDispatchId ?? null,
              contributorAgentRole: row.contributorAgentRole,
              sliceDescription: row.sliceDescription,
              contributionText: row.contributionText,
              contributedAt: now,
              weight: row.weight ?? null,
            };
            CONTRIBS.push(created);
            return [{ id: created.id }];
          }
          throw new Error("insert: unknown table");
        },
      }),
    }),
    update: (table: any) => ({
      set: (patch: any) => ({
        where: (clause: WhereTag) => {
          const apply = () => {
            const updated: { id: number }[] = [];
            if (table?.__name === "sessions") {
              for (const row of SESSIONS) {
                if (!matchSession(row, clause)) continue;
                if (patch.status !== undefined) row.status = patch.status;
                if (patch.closedAt !== undefined) row.closedAt = patch.closedAt;
                if (patch.synthesisOutput !== undefined)
                  row.synthesisOutput = patch.synthesisOutput;
                if (patch.finalConclusion !== undefined)
                  row.finalConclusion = patch.finalConclusion;
                if (patch.finalConfidence !== undefined)
                  row.finalConfidence = patch.finalConfidence;
                updated.push({ id: row.id });
              }
            }
            return updated;
          };
          return {
            then: (resolve: (v: any) => void) => resolve(apply()),
            returning: async (_cols: any) => apply(),
          };
        },
      }),
    }),
    select: (_cols?: any) => ({
      from: (table: any) => ({
        where: (clause: WhereTag) => {
          const matching = () => {
            if (table?.__name === "sessions") {
              return SESSIONS.filter((r) => matchSession(r, clause));
            }
            if (table?.__name === "contributions") {
              return CONTRIBS.filter((r) => matchContrib(r, clause));
            }
            return [];
          };
          return {
            orderBy: (_o: any) => ({
              limit: async (n: number) =>
                matching()
                  .slice()
                  .sort((a: any, b: any) => {
                    const ax = (a as SessionRow).openedAt?.getTime?.() ?? 0;
                    const bx = (b as SessionRow).openedAt?.getTime?.() ?? 0;
                    return bx - ax;
                  })
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
      const owner = col?.__owner;
      const name = col?.name ?? "";
      if (owner === "sessions") {
        if (name === "id") return { kind: "session-by-id", id: val };
        if (name === "status") return { kind: "session-status", status: val };
      }
      if (owner === "contributions") {
        if (name === "session_id")
          return { kind: "contrib-session", sessionId: val };
      }
      return { kind: "session-by-id", id: -1 };
    },
    and: (...parts: WhereTag[]): WhereTag => parts[0],
    desc: (col: any) => ({ __desc: col }),
  };
});

vi.mock("@shared/schema/solene-distributed-reasoning", async () => {
  const actual = await vi.importActual<
    typeof import("@shared/schema/solene-distributed-reasoning")
  >("@shared/schema/solene-distributed-reasoning");
  return {
    ...actual,
    soleneReasoningSessions: {
      ...actual.soleneReasoningSessions,
      __name: "sessions",
      id: { name: "id", __owner: "sessions" },
      status: { name: "status", __owner: "sessions" },
      openedAt: { name: "opened_at", __owner: "sessions" },
    },
    soleneReasoningContributions: {
      ...actual.soleneReasoningContributions,
      __name: "contributions",
      id: { name: "id", __owner: "contributions" },
      sessionId: { name: "session_id", __owner: "contributions" },
    },
  };
});

beforeEach(() => {
  SESSIONS.length = 0;
  CONTRIBS.length = 0;
  nextSessionId = 1;
  nextContribId = 1;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// openSession
// ============================================================================

describe("distributedReasoning.openSession", () => {
  it("happy path inserts row + returns id", async () => {
    const { openSession } = await import("./distributedReasoning");
    const { sessionId } = await openSession({
      openedByAgentRole: "iris",
      topic: "embedding refresh strategy",
      problemStatement:
        "Decide whether to refresh embeddings nightly or on-demand.",
      decompositionStrategy: "parallel_perspectives",
      expectedSubDispatchCount: 3,
    });
    expect(sessionId).toBe(1);
    expect(SESSIONS).toHaveLength(1);
    expect(SESSIONS[0].status).toBe("open");
    expect(SESSIONS[0].decompositionStrategy).toBe("parallel_perspectives");
    expect(SESSIONS[0].expectedSubDispatchCount).toBe(3);
  });

  it("rejects invalid strategy", async () => {
    const { openSession } = await import("./distributedReasoning");
    await expect(
      openSession({
        openedByAgentRole: "iris",
        topic: "x",
        problemStatement: "x",
        // @ts-expect-error — intentionally invalid
        decompositionStrategy: "monte_carlo",
        expectedSubDispatchCount: 2,
      }),
    ).rejects.toThrow(/invalid decompositionStrategy/);
  });

  it("rejects non-positive expectedSubDispatchCount", async () => {
    const { openSession } = await import("./distributedReasoning");
    await expect(
      openSession({
        openedByAgentRole: "iris",
        topic: "x",
        problemStatement: "x",
        decompositionStrategy: "map_reduce",
        expectedSubDispatchCount: 0,
      }),
    ).rejects.toThrow(/must be a positive integer/);
  });
});

// ============================================================================
// recordContribution
// ============================================================================

describe("distributedReasoning.recordContribution", () => {
  it("defaults weight = 1 / expectedSubDispatchCount", async () => {
    const { openSession, recordContribution } = await import(
      "./distributedReasoning"
    );
    const { sessionId } = await openSession({
      openedByAgentRole: "iris",
      topic: "t",
      problemStatement: "p",
      decompositionStrategy: "map_reduce",
      expectedSubDispatchCount: 4,
    });
    const { contributionId } = await recordContribution({
      sessionId,
      contributorAgentRole: "soren",
      sliceDescription: "slice 1",
      contributionText: "the answer to slice 1",
    });
    expect(contributionId).toBe(1);
    expect(CONTRIBS).toHaveLength(1);
    // 1/4 = 0.25 → "0.2500"
    expect(CONTRIBS[0].weight).toBe("0.2500");
  });

  it("honors explicit weight", async () => {
    const { openSession, recordContribution } = await import(
      "./distributedReasoning"
    );
    const { sessionId } = await openSession({
      openedByAgentRole: "iris",
      topic: "t",
      problemStatement: "p",
      decompositionStrategy: "adversarial_pair",
      expectedSubDispatchCount: 2,
    });
    await recordContribution({
      sessionId,
      contributorAgentRole: "beatrice",
      sliceDescription: "compliance perspective",
      contributionText: "policy says ...",
      weight: 0.75,
    });
    expect(CONTRIBS[0].weight).toBe("0.7500");
  });

  it("throws on terminal session", async () => {
    const { openSession, abandonSession, recordContribution } = await import(
      "./distributedReasoning"
    );
    const { sessionId } = await openSession({
      openedByAgentRole: "iris",
      topic: "t",
      problemStatement: "p",
      decompositionStrategy: "map_reduce",
      expectedSubDispatchCount: 2,
    });
    await abandonSession(sessionId, "no longer relevant");
    await expect(
      recordContribution({
        sessionId,
        contributorAgentRole: "iris",
        sliceDescription: "s",
        contributionText: "c",
      }),
    ).rejects.toThrow(/terminal/);
  });
});

// ============================================================================
// synthesizeSession
// ============================================================================

describe("distributedReasoning.synthesizeSession", () => {
  it("closes session + writes synthesis fields", async () => {
    const { openSession, synthesizeSession, getSession } = await import(
      "./distributedReasoning"
    );
    const { sessionId } = await openSession({
      openedByAgentRole: "iris",
      topic: "t",
      problemStatement: "p",
      decompositionStrategy: "divide_and_conquer",
      expectedSubDispatchCount: 2,
    });
    await synthesizeSession(sessionId, {
      synthesisOutput: "unified output",
      finalConclusion: "ship it",
      finalConfidence: 0.85,
    });
    const row = await getSession(sessionId);
    expect(row?.status).toBe("closed");
    expect(row?.closedAt).not.toBeNull();
    expect(row?.synthesisOutput).toBe("unified output");
    expect(row?.finalConclusion).toBe("ship it");
    expect(row?.finalConfidence).toBe("0.8500");
  });

  it("throws when session already closed", async () => {
    const { openSession, synthesizeSession } = await import(
      "./distributedReasoning"
    );
    const { sessionId } = await openSession({
      openedByAgentRole: "iris",
      topic: "t",
      problemStatement: "p",
      decompositionStrategy: "map_reduce",
      expectedSubDispatchCount: 2,
    });
    await synthesizeSession(sessionId, {
      synthesisOutput: "out",
      finalConclusion: "c",
      finalConfidence: 0.5,
    });
    await expect(
      synthesizeSession(sessionId, {
        synthesisOutput: "out2",
        finalConclusion: "c2",
        finalConfidence: 0.6,
      }),
    ).rejects.toThrow(/terminal/);
  });

  it("rejects finalConfidence outside [0,1]", async () => {
    const { openSession, synthesizeSession } = await import(
      "./distributedReasoning"
    );
    const { sessionId } = await openSession({
      openedByAgentRole: "iris",
      topic: "t",
      problemStatement: "p",
      decompositionStrategy: "map_reduce",
      expectedSubDispatchCount: 2,
    });
    await expect(
      synthesizeSession(sessionId, {
        synthesisOutput: "out",
        finalConclusion: "c",
        finalConfidence: 1.5,
      }),
    ).rejects.toThrow(/must be in \[0,1\]/);
  });
});

// ============================================================================
// abandonSession
// ============================================================================

describe("distributedReasoning.abandonSession", () => {
  it("sets status='abandoned' + final_conclusion='abandoned'", async () => {
    const { openSession, abandonSession, getSession } = await import(
      "./distributedReasoning"
    );
    const { sessionId } = await openSession({
      openedByAgentRole: "iris",
      topic: "t",
      problemStatement: "p",
      decompositionStrategy: "map_reduce",
      expectedSubDispatchCount: 2,
    });
    await abandonSession(sessionId, "founder deprioritized");
    const row = await getSession(sessionId);
    expect(row?.status).toBe("abandoned");
    expect(row?.finalConclusion).toBe("abandoned");
    expect(row?.closedAt).not.toBeNull();
  });

  it("throws when already terminal", async () => {
    const { openSession, abandonSession } = await import(
      "./distributedReasoning"
    );
    const { sessionId } = await openSession({
      openedByAgentRole: "iris",
      topic: "t",
      problemStatement: "p",
      decompositionStrategy: "map_reduce",
      expectedSubDispatchCount: 2,
    });
    await abandonSession(sessionId, "reason");
    await expect(abandonSession(sessionId, "again")).rejects.toThrow(
      /already terminal/,
    );
  });
});

// ============================================================================
// getSessionWithContributions + listOpenSessions
// ============================================================================

describe("distributedReasoning.getSessionWithContributions", () => {
  it("returns joined session + contributions", async () => {
    const {
      openSession,
      recordContribution,
      getSessionWithContributions,
    } = await import("./distributedReasoning");
    const { sessionId } = await openSession({
      openedByAgentRole: "iris",
      topic: "t",
      problemStatement: "p",
      decompositionStrategy: "parallel_perspectives",
      expectedSubDispatchCount: 2,
    });
    await recordContribution({
      sessionId,
      contributorAgentRole: "iris",
      sliceDescription: "engineering perspective",
      contributionText: "tech says X",
    });
    await recordContribution({
      sessionId,
      contributorAgentRole: "beatrice",
      sliceDescription: "compliance perspective",
      contributionText: "policy says Y",
    });
    const result = await getSessionWithContributions(sessionId);
    expect(result).not.toBeNull();
    expect(result!.session.id).toBe(sessionId);
    expect(result!.contributions).toHaveLength(2);
  });

  it("returns null when session missing", async () => {
    const { getSessionWithContributions } = await import(
      "./distributedReasoning"
    );
    const result = await getSessionWithContributions(9999);
    expect(result).toBeNull();
  });
});

describe("distributedReasoning.listOpenSessions", () => {
  it("filters to status='open' only", async () => {
    const { openSession, abandonSession, listOpenSessions } = await import(
      "./distributedReasoning"
    );
    const { sessionId: s1 } = await openSession({
      openedByAgentRole: "iris",
      topic: "t1",
      problemStatement: "p",
      decompositionStrategy: "map_reduce",
      expectedSubDispatchCount: 2,
    });
    await openSession({
      openedByAgentRole: "iris",
      topic: "t2",
      problemStatement: "p",
      decompositionStrategy: "map_reduce",
      expectedSubDispatchCount: 2,
    });
    await abandonSession(s1, "reason");
    const open = await listOpenSessions();
    expect(open).toHaveLength(1);
    expect(open[0].topic).toBe("t2");
  });
});

// ============================================================================
// PURE HELPERS
// ============================================================================

describe("distributedReasoning.weightedAggregate", () => {
  it("computes the weighted mean", async () => {
    const { weightedAggregate } = await import("./distributedReasoning");
    // (0.2*10 + 0.8*20) / (0.2+0.8) = (2 + 16) / 1 = 18
    expect(
      weightedAggregate([
        { weight: 0.2, value: 10 },
        { weight: 0.8, value: 20 },
      ]),
    ).toBeCloseTo(18, 5);
  });

  it("returns 0 for empty input", async () => {
    const { weightedAggregate } = await import("./distributedReasoning");
    expect(weightedAggregate([])).toBe(0);
  });

  it("falls back to simple mean when all weights are 0", async () => {
    const { weightedAggregate } = await import("./distributedReasoning");
    expect(
      weightedAggregate([
        { weight: 0, value: 10 },
        { weight: 0, value: 30 },
      ]),
    ).toBe(20);
  });
});

describe("distributedReasoning.buildSynthesizerPrompt", () => {
  it("includes topic + problem statement + all contributions", async () => {
    const {
      openSession,
      recordContribution,
      getSessionWithContributions,
      buildSynthesizerPrompt,
    } = await import("./distributedReasoning");
    const { sessionId } = await openSession({
      openedByAgentRole: "iris",
      topic: "embedding strategy",
      problemStatement: "Nightly vs on-demand refresh?",
      decompositionStrategy: "adversarial_pair",
      expectedSubDispatchCount: 2,
    });
    await recordContribution({
      sessionId,
      contributorAgentRole: "iris",
      sliceDescription: "pro-nightly slice",
      contributionText: "Nightly amortizes the cost.",
    });
    await recordContribution({
      sessionId,
      contributorAgentRole: "soren",
      sliceDescription: "pro-on-demand slice",
      contributionText: "On-demand keeps freshness high.",
    });
    const result = await getSessionWithContributions(sessionId);
    const prompt = buildSynthesizerPrompt(
      result!.session,
      result!.contributions,
    );
    expect(prompt).toContain("embedding strategy");
    expect(prompt).toContain("Nightly vs on-demand refresh?");
    expect(prompt).toContain("adversarial_pair");
    expect(prompt).toContain("pro-nightly slice");
    expect(prompt).toContain("Nightly amortizes the cost.");
    expect(prompt).toContain("pro-on-demand slice");
    expect(prompt).toContain("On-demand keeps freshness high.");
    expect(prompt).toContain("synthesis_output");
    expect(prompt).toContain("final_conclusion");
    expect(prompt).toContain("final_confidence");
  });

  it("handles empty contributions gracefully", async () => {
    const { openSession, getSessionWithContributions, buildSynthesizerPrompt } =
      await import("./distributedReasoning");
    const { sessionId } = await openSession({
      openedByAgentRole: "iris",
      topic: "t",
      problemStatement: "p",
      decompositionStrategy: "map_reduce",
      expectedSubDispatchCount: 2,
    });
    const result = await getSessionWithContributions(sessionId);
    const prompt = buildSynthesizerPrompt(
      result!.session,
      result!.contributions,
    );
    expect(prompt).toContain("(none recorded)");
  });
});
