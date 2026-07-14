/**
 * Cascade × founder precedent (Jarvis 2.3).
 *
 * Pins the attach-only contract at the Layer-5 seam:
 *  - a strong precedent match (≥ 0.62) does NOT auto-resolve — the cascade
 *    still escalates, WITH the precedent(s) attached to the layer detail and
 *    a `precedent_hit_on_escalation` activity logged;
 *  - a weak match attaches nothing;
 *  - a retrieval failure escalates exactly as today (fail-open).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Layer collaborators — all primed so every layer skips → escalation ─────

vi.mock("../../server/services/cognitiveMemoryV13", () => ({
  cognitiveMemoryService: {
    recallEpisodes: vi.fn(async () => []),
    recordEpisode: vi.fn(async () => null),
  },
}));

vi.mock("../../server/services/companyChronicle", () => ({
  companyChronicleService: { search: vi.fn(async () => []) },
}));

vi.mock("../../server/services/adaptiveStrategyV13", () => ({
  adaptiveStrategyService: { selectStrategy: vi.fn(async () => null) },
}));

vi.mock("../../server/services/collaborationProtocolV13", () => ({
  collaborationProtocolService: { delegate: vi.fn(async () => null) },
}));

vi.mock("../../server/services/governanceBrainV13", () => ({
  governanceBrainService: { evaluateAction: vi.fn(async () => null) },
}));

vi.mock("../../server/services/selfHealingMeshV13", () => ({
  selfHealingMeshService: {},
}));

// ─── Precedent retrieval (controllable) + activity audit ────────────────────

let retrievalMode: "hit" | "weak" | "empty" | "throw" = "empty";
const retrieveMock = vi.fn(async (query: any) => {
  if (retrievalMode === "throw") throw new Error("retrieval exploded");
  if (retrievalMode === "hit") {
    return {
      retrievalEventId: 1,
      retrieved: [
        {
          sourceRef: "founder_precedent:decision:42",
          contentSnippet: "SITUATION […]: …\nFOUNDER RULING: rejected\nWHY: …",
          similarityScore: 0.71,
        },
        {
          sourceRef: "founder_precedent:decision:7",
          contentSnippet: "SITUATION […]: …",
          similarityScore: 0.5, // below the attach floor — must be filtered
        },
      ],
      latencyMs: 3,
    };
  }
  if (retrievalMode === "weak") {
    return {
      retrievalEventId: 1,
      retrieved: [
        {
          sourceRef: "founder_precedent:decision:7",
          contentSnippet: "SITUATION […]: …",
          similarityScore: 0.5,
        },
      ],
      latencyMs: 3,
    };
  }
  return { retrievalEventId: -1, retrieved: [], latencyMs: 1 };
});

vi.mock("../../server/services/solene/learningLoop", () => ({
  retrieveRelevantMemories: (query: any) => retrieveMock(query),
}));

const logActivityMock = vi.fn(async () => {});
vi.mock("../../server/services/systemActivityLogger", () => ({
  logActivity: (p: any) => logActivityMock(p),
  withActivityOnError: vi.fn(),
}));

// ─── DB mock — cascade writes a tracking row, then updates it ───────────────

const DB_UPDATES: Array<Record<string, any>> = [];
vi.mock("../../server/db", () => {
  const db = {
    insert: (_t: any) => ({ values: async (_row: any) => {} }),
    update: (_t: any) => ({
      set: (values: Record<string, any>) => ({
        where: async (_w: any) => {
          DB_UPDATES.push(values);
        },
      }),
    }),
  };
  return { db };
});

import { confidenceCascadeService } from "../../server/services/confidenceCascadeV14";

const REQUEST = {
  triggerType: "pricing_exception",
  triggerContext: { type: "pricing" },
  originAgent: "forge_revenue",
  decisionNeeded: "Discount annual plan for org #7 beyond 20%?",
  currentConfidence: 10,
};

beforeEach(() => {
  retrievalMode = "empty";
  DB_UPDATES.length = 0;
  vi.clearAllMocks();
});

function founderLayer(result: Awaited<ReturnType<typeof confidenceCascadeService.resolve>>) {
  return result.layersAttempted.find((l) => l.layer === "founder_escalation");
}

describe("precedent hit on escalation — attach-only, never auto-resolve", () => {
  it("escalates WITH the strong precedent attached + logs precedent_hit_on_escalation", async () => {
    retrievalMode = "hit";
    const result = await confidenceCascadeService.resolve(1, REQUEST);

    // Still an escalation — a precedent match must never auto-resolve.
    expect(result.status).toBe("escalated");
    expect(result.founderEscalated).toBe(true);

    const layer = founderLayer(result);
    expect(layer?.details.precedents).toEqual([
      {
        sourceRef: "founder_precedent:decision:42",
        snippet: "SITUATION […]: …\nFOUNDER RULING: rejected\nWHY: …",
        similarity: 0.71,
      },
    ]);
    // Retrieval was scoped to the founder_precedent namespace.
    expect(retrieveMock).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: "founder_precedent", topK: 3 }),
    );
    expect(logActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ job: "cascade", action: "precedent_hit_on_escalation" }),
    );
  });

  it("a best match below 0.62 attaches nothing", async () => {
    retrievalMode = "weak";
    const result = await confidenceCascadeService.resolve(1, REQUEST);

    expect(result.status).toBe("escalated");
    expect(founderLayer(result)?.details.precedents).toBeUndefined();
    expect(logActivityMock).not.toHaveBeenCalled();
  });

  it("FAIL-OPEN: retrieval throw escalates exactly as today — no precedents, no activity, no error", async () => {
    retrievalMode = "throw";
    const result = await confidenceCascadeService.resolve(1, REQUEST);

    expect(result.status).toBe("escalated");
    expect(result.founderEscalated).toBe(true);
    expect(founderLayer(result)?.details.precedents).toBeUndefined();
    expect(founderLayer(result)?.details.reason).toContain("escalating to founder");
    expect(logActivityMock).not.toHaveBeenCalled();
  });

  it("empty corpus escalates exactly as today", async () => {
    retrievalMode = "empty";
    const result = await confidenceCascadeService.resolve(1, REQUEST);

    expect(result.status).toBe("escalated");
    expect(founderLayer(result)?.details.precedents).toBeUndefined();
  });
});
