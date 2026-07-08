/**
 * Launch-Week WS3 — "The Brain" — founder-chat context assembly eval.
 *
 * Pins the four WS3 guarantees:
 *  (a) strategy docs are injected with [SOURCE: docs/company/…] labels;
 *  (b) the live-state block carries real values through, and absent values
 *      as explicit "unknown" — honest nulls, never invented numbers;
 *  (c) the system prompt carries the no-fabrication instruction;
 *  (d) steer-command parsing handles the supported verbs
 *      (pause/resume, spend queries, status).
 *
 * Plus the committed CEO Q&A eval: the five hard CEO questions
 * (ceoQuestions.ts) each assert that the context assembly ACTUALLY contains
 * every source required to ground the answer — strategy retrieval runs
 * against the REAL repo docs, so a renamed/gutted doc or a broken scorer
 * fails here, not in front of the founder.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// DB-backed memory layer stubbed — this suite is about WS3 injection.
vi.mock("../../server/services/solene/memoryFileStore", () => ({
  async getMemoryFile() {
    return null;
  },
  async listMemoryFiles() {
    return [];
  },
}));

vi.mock("../../server/services/solene/learningLoop", () => ({
  async retrieveRelevantMemories() {
    return { retrievalEventId: 1, retrieved: [], latencyMs: 1 };
  },
}));

// Live-state GATHER is stubbed (no DB in unit tests); the RENDERER stays
// real so what we assert on is the genuine prompt text.
let LIVE_STATE_FIXTURE: import("../../server/services/solene/chat/liveState").FounderLiveState;

vi.mock("../../server/services/solene/chat/liveState", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../server/services/solene/chat/liveState")>();
  return {
    ...actual,
    async gatherLiveState() {
      return LIVE_STATE_FIXTURE;
    },
  };
});

import { buildChatContext, SOLENE_ROLE_PREAMBLE } from "../../server/services/solene/chat/contextBuilder";
import {
  buildStrategyBlocks,
  clearStrategyDocCache,
  selectStrategySections,
  splitIntoSections,
  tokenizeQuery,
  STRATEGY_DOCS,
} from "../../server/services/solene/chat/strategyDocs";
import {
  renderLiveStateBlock,
  type FounderLiveState,
} from "../../server/services/solene/chat/liveState";
import { CEO_EVAL_QUESTIONS } from "../../server/services/solene/chat/ceoQuestions";
import { parseSteerCommand } from "../../server/services/autopilot/steer";

function liveStateWithData(): FounderLiveState {
  return {
    asOf: "2026-07-07T12:00:00.000Z",
    pulse: {
      generatedAt: "2026-07-07T11:00:00.000Z",
      mrr: 120,
      trials: 3,
      weeklySpendUsd: 4.2,
      envelopeStatus: "green",
      uptimePct: 99.4,
      dispatchesCompletedLast24h: 7,
      dispatchesFlaggedLast24h: 1,
      decisionsWaitingCount: 2,
      prodVersion: "abc1234",
    },
    envelope: {
      envelopeUsd: 50,
      monthToDateUsd: 11.5,
      percentUsed: 23,
      projectedMonthlyUsd: 49.3,
      status: "green",
    },
    trustLedger: [
      { domain: "growth", level: "draft", cleanCycleCount: 4, threshold: 10 },
    ],
    openAsks: [{ askId: 9, summary: "Approve the July mail batch", urgency: "normal" }],
    runwayWeeks: 26,
  };
}

function liveStateAllUnknown(): FounderLiveState {
  return {
    asOf: "2026-07-07T12:00:00.000Z",
    pulse: null,
    envelope: null,
    trustLedger: null,
    openAsks: null,
    runwayWeeks: null,
  };
}

beforeEach(() => {
  clearStrategyDocCache();
  LIVE_STATE_FIXTURE = liveStateWithData();
});

// ============================================================================
// (a) Strategy docs — injected with source labels
// ============================================================================

describe("strategy-doc retrieval (real repo docs)", () => {
  it("every registered strategy doc exists and splits into sections", async () => {
    // A renamed or deleted doc must fail loudly here.
    const blocks = await buildStrategyBlocks(
      "constitution gates roadmap deletion cost launch",
    );
    expect(blocks.length).toBeGreaterThan(1);
    // The index block always names the whole library.
    const index = blocks.find((b) => b.label === "strategy:index");
    expect(index).toBeDefined();
    for (const spec of STRATEGY_DOCS) {
      expect(index!.content).toContain(`docs/company/${spec.file}`);
    }
  });

  it("selected sections carry a [SOURCE: docs/company/…] citation label", async () => {
    const blocks = await buildStrategyBlocks("what's the next gate on the roadmap?");
    const roadmap = blocks.find((b) => b.docId === "roadmap-2026-07");
    expect(roadmap).toBeDefined();
    expect(roadmap!.content).toMatch(/^\[SOURCE: docs\/company\/roadmap-2026-07\.md § "/);
  });

  it("keyword-matched docs are guaranteed their top section", () => {
    const sections = new Map([
      [
        "roadmap-2026-07",
        {
          spec: { id: "roadmap-2026-07", keywords: ["roadmap", "gate"] },
          sections: splitIntoSections(
            { id: "roadmap-2026-07", file: "roadmap-2026-07.md" },
            "# Roadmap\n\nintro text\n\n## Gates\n\ngate one is $200 MRR",
          ),
        },
      ],
    ]);
    const picked = selectStrategySections("what's the next gate?", sections);
    expect(picked.length).toBeGreaterThan(0);
    expect(picked[0].docId).toBe("roadmap-2026-07");
  });

  it("tokenizeQuery drops stopwords but keeps short content terms like 'ad'", () => {
    const terms = tokenizeQuery("What would you do with $500 of ad budget?");
    expect(terms).toContain("ad");
    expect(terms).toContain("budget");
    expect(terms).not.toContain("what");
    expect(terms).not.toContain("of");
  });
});

// ============================================================================
// (b) Live state — real values through, absent values explicit
// ============================================================================

describe("live-state block (pure renderer)", () => {
  it("carries real values with the as-of timestamp and source label", () => {
    const out = renderLiveStateBlock(liveStateWithData());
    expect(out).toContain("[SOURCE: live-state]");
    expect(out).toContain("as of 2026-07-07T12:00:00.000Z");
    expect(out).toContain("MRR: $120.00");
    expect(out).toContain("Spend last 7 days (pulse): $4.20");
    expect(out).toContain("$11.50 of $50.00 used");
    expect(out).toContain("~26 weeks");
    expect(out).toContain("growth=draft (4/10 clean cycles)");
    expect(out).toContain("Approve the July mail batch");
    expect(out).toContain("Dispatches flagged last 24h: 1");
  });

  it("HONEST NULLS: absent data is stated absent, never defaulted", () => {
    const out = renderLiveStateBlock(liveStateAllUnknown());
    expect(out).toContain("Morning pulse: unknown (no data yet");
    expect(out).toContain("MRR: unknown (no data yet");
    expect(out).toContain("Monthly AI envelope: unknown (no data yet");
    expect(out).toContain("Trust ledger: unknown (no data yet");
    expect(out).toContain("Open founder asks: unknown (no data yet");
    expect(out).toContain("Runway: no figure");
    // No fabricated numbers anywhere.
    expect(out).not.toContain("$0.00");
    expect(out).not.toMatch(/MRR: \$\d/);
  });

  it("distinguishes 'honestly empty' from 'unreadable'", () => {
    const state = { ...liveStateAllUnknown(), trustLedger: [], openAsks: [] };
    const out = renderLiveStateBlock(state);
    expect(out).toContain("Trust ledger: no domains recorded yet");
    expect(out).toContain("Open founder asks: none");
  });
});

// ============================================================================
// (c) System prompt — the no-fabrication instruction
// ============================================================================

describe("system prompt grounding contract", () => {
  it("the role preamble pins the no-fabrication instruction", () => {
    expect(SOLENE_ROLE_PREAMBLE).toContain("GROUNDING AND HONESTY");
    expect(SOLENE_ROLE_PREAMBLE).toContain("NEVER estimate, extrapolate, or fabricate a number");
    expect(SOLENE_ROLE_PREAMBLE).toContain('answer "no data yet"');
    expect(SOLENE_ROLE_PREAMBLE).toContain("[SOURCE:");
  });

  it("buildChatContext emits the preamble in the cached static prefix", async () => {
    const out = await buildChatContext({
      userMessage: "hello",
      conversationId: 1,
      tier: "conversational",
    });
    expect(out.staticPrefix).toContain("GROUNDING AND HONESTY");
    expect(out.staticPrefix).toContain("NEVER estimate, extrapolate, or fabricate a number");
  });
});

// ============================================================================
// (d) Steer verbs — pause/resume, spend, status
// ============================================================================

describe("steer-command coverage for the founder chat's claimed verbs", () => {
  it("pause + resume, domain and whole-company", () => {
    expect(parseSteerCommand("pause growth")).toEqual({ kind: "pause_domain", domain: "growth" });
    expect(parseSteerCommand("pause the autopilot")).toEqual({ kind: "pause_all" });
    expect(parseSteerCommand("resume the autopilot")).toEqual({ kind: "resume_all" });
    expect(parseSteerCommand("resume growth")).toEqual({ kind: "trust_domain", domain: "growth" });
  });

  it("spend queries route to the capital ledger", () => {
    expect(parseSteerCommand("what did we spend on AI this week?")).toEqual({ kind: "spend" });
    expect(parseSteerCommand("what's our runway?")).toEqual({ kind: "spend" });
  });

  it("status and why still work", () => {
    expect(parseSteerCommand("status")).toEqual({ kind: "status", domain: undefined });
    expect(parseSteerCommand("why did you do that?")).toEqual({ kind: "why" });
  });
});

// ============================================================================
// The five hard CEO questions — every answer sourced
// ============================================================================

describe("CEO Q&A eval — context assembly grounds each hard question", () => {
  it("fixture stays at exactly five questions", () => {
    expect(CEO_EVAL_QUESTIONS).toHaveLength(5);
  });

  for (const q of CEO_EVAL_QUESTIONS) {
    it(`"${q.question}" — context contains ${q.requiredSources.join(" + ")}`, async () => {
      const out = await buildChatContext({
        userMessage: q.question,
        conversationId: 42,
        tier: "conversational",
      });
      const labels = out.blocks.map((b) => b.label);

      for (const src of q.requiredSources) {
        if (src === "live_state") {
          expect(labels).toContain("live-state");
          expect(out.dynamicSuffix).toContain("[SOURCE: live-state]");
        } else {
          expect(labels).toContain(`strategy:${src}`);
          const spec = STRATEGY_DOCS.find((d) => d.id === src);
          expect(spec).toBeDefined();
          expect(out.dynamicSuffix).toContain(`[SOURCE: docs/company/${spec!.file}`);
        }
      }
    });
  }

  it("when live state is empty, the assembled context says unknown — not a number", async () => {
    LIVE_STATE_FIXTURE = liveStateAllUnknown();
    const out = await buildChatContext({
      userMessage: "What's our runway?",
      conversationId: 42,
      tier: "conversational",
    });
    expect(out.dynamicSuffix).toContain("MRR: unknown (no data yet");
    expect(out.dynamicSuffix).toContain("Runway: no figure");
  });
});
