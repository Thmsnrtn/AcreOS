/**
 * Tests for Solene Discovery → Decision → Dispatch → Delivery pipeline
 * service (Phase B L2.9).
 *
 * Coverage:
 *  - openPipeline → returns id, stage='discovery'
 *  - openPipeline rejects invalid pipelineKind
 *  - Full happy path: open → decision → dispatch → delivery → close
 *  - Skip-decision: open → dispatch → delivery → close
 *  - Invalid transition: discovery → delivery directly throws
 *  - Invalid transition: decision → delivery directly throws
 *  - closePipeline accepts all 4 outcomes
 *  - closePipeline rejects invalid outcome
 *  - closePipeline requires stage='delivery'
 *  - abandonPipeline sets stage + final_outcome + notes
 *  - abandonPipeline rejects empty reason
 *  - abandonPipeline cannot terminate a terminal pipeline
 *  - listPipelines filters by stage + kind + limit
 *  - getPipeline returns null for nonexistent id
 *  - getFunnelSummary counts correctness + null-skipping averages
 *  - getFunnelSummary rejects non-positive windowDays
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

interface PipelineRow {
  id: number;
  createdAt: Date;
  updatedAt: Date;
  pipelineKind: string;
  currentStage: string;
  triggeringSourceKind: string | null;
  triggeringSourceId: string | null;
  improvementOpportunityId: number | null;
  planProposalId: number | null;
  dispatchId: number | null;
  reviewDispatchId: number | null;
  finalOutcome: string | null;
  finalOutcomeNotes: string | null;
  durationMsDiscoveryToDecision: number | null;
  durationMsDecisionToDispatch: number | null;
  durationMsDispatchToDelivery: number | null;
}

const ROWS: PipelineRow[] = [];
let nextId = 1;

type WhereTag =
  | { kind: "by-id"; id: number }
  | { kind: "by-stage"; stage: string }
  | { kind: "by-kind"; pipelineKind: string }
  | { kind: "by-stage-and-kind"; stage: string; pipelineKind: string }
  | { kind: "by-created-since"; since: Date };

vi.mock("../../db", () => {
  const db = {
    insert: (_table: unknown) => ({
      values: (row: any) => ({
        returning: async (_cols: any) => {
          const created: PipelineRow = {
            id: nextId++,
            createdAt: row.createdAt ?? new Date(),
            updatedAt: row.updatedAt ?? new Date(),
            pipelineKind: row.pipelineKind,
            currentStage: row.currentStage ?? "discovery",
            triggeringSourceKind: row.triggeringSourceKind ?? null,
            triggeringSourceId: row.triggeringSourceId ?? null,
            improvementOpportunityId: row.improvementOpportunityId ?? null,
            planProposalId: null,
            dispatchId: null,
            reviewDispatchId: null,
            finalOutcome: null,
            finalOutcomeNotes: null,
            durationMsDiscoveryToDecision: null,
            durationMsDecisionToDispatch: null,
            durationMsDispatchToDelivery: null,
          };
          ROWS.push(created);
          return [{ id: created.id }];
        },
      }),
    }),
    update: (_table: unknown) => ({
      set: (patch: any) => ({
        where: async (clause: WhereTag) => {
          if (clause?.kind !== "by-id") return;
          const row = ROWS.find((p) => p.id === clause.id);
          if (!row) return;
          for (const k of Object.keys(patch)) {
            (row as any)[k] = patch[k];
          }
        },
      }),
    }),
    select: (_cols?: any) => ({
      from: (_t: unknown) => {
        function matchRows(clause?: any): PipelineRow[] {
          if (!clause) return ROWS.slice();
          if (clause.kind === "by-id")
            return ROWS.filter((p) => p.id === clause.id);
          if (clause.kind === "by-stage")
            return ROWS.filter((p) => p.currentStage === clause.stage);
          if (clause.kind === "by-kind")
            return ROWS.filter((p) => p.pipelineKind === clause.pipelineKind);
          if (clause.kind === "by-stage-and-kind")
            return ROWS.filter(
              (p) =>
                p.currentStage === clause.stage &&
                p.pipelineKind === clause.pipelineKind,
            );
          if (clause.kind === "by-created-since")
            return ROWS.filter(
              (p) => p.createdAt.getTime() >= clause.since.getTime(),
            );
          // Bare eq() shape: { __field, value }.
          if (clause.__field === "pipeline_kind")
            return ROWS.filter((p) => p.pipelineKind === clause.value);
          if (clause.__field === "current_stage")
            return ROWS.filter((p) => p.currentStage === clause.value);
          return [];
        }
        function makeTerminals(rows: PipelineRow[]) {
          return {
            orderBy: (_o: any) => ({
              limit: async (n: number) => {
                return rows
                  .slice()
                  .sort(
                    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
                  )
                  .slice(0, n);
              },
            }),
            limit: async (n: number) => rows.slice(0, n),
            then: (resolve: any) => resolve(rows.slice()),
          };
        }
        return {
          where: (clause: WhereTag) => makeTerminals(matchRows(clause)),
          orderBy: (_o: any) => ({
            limit: async (n: number) => {
              return ROWS.slice()
                .sort(
                  (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
                )
                .slice(0, n);
            },
          }),
        };
      },
    }),
  };
  return { db };
});

vi.mock("drizzle-orm", async () => {
  const actual =
    await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (col: any, val: any) => {
      const name = col?.name ?? "";
      if (name === "id") return { kind: "by-id", id: val };
      if (name === "current_stage")
        return { __field: "current_stage", value: val };
      if (name === "pipeline_kind")
        return { __field: "pipeline_kind", value: val };
      return { __field: name, value: val };
    },
    gte: (col: any, val: any) => {
      const name = col?.name ?? "";
      if (name === "created_at")
        return { kind: "by-created-since", since: val };
      return { __field: name, value: val };
    },
    and: (...parts: any[]) => {
      const stage = parts.find((p) => p?.__field === "current_stage")?.value;
      const pipelineKind = parts.find(
        (p) => p?.__field === "pipeline_kind",
      )?.value;
      if (stage && pipelineKind)
        return { kind: "by-stage-and-kind", stage, pipelineKind };
      if (stage) return { kind: "by-stage", stage };
      if (pipelineKind) return { kind: "by-kind", pipelineKind };
      return parts[0];
    },
    desc: (col: any) => ({ __desc: col }),
  };
});

vi.mock("@shared/schema/solene-pipeline", async () => {
  const actual = await vi.importActual<
    typeof import("@shared/schema/solene-pipeline")
  >("@shared/schema/solene-pipeline");
  return {
    ...actual,
    solenePipelines: {
      ...actual.solenePipelines,
      id: { name: "id" },
      currentStage: { name: "current_stage" },
      pipelineKind: { name: "pipeline_kind" },
      updatedAt: { name: "updated_at" },
      createdAt: { name: "created_at" },
    },
  };
});

beforeEach(() => {
  ROWS.length = 0;
  nextId = 1;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// openPipeline
// ---------------------------------------------------------------------------

describe("pipeline.openPipeline", () => {
  it("returns id, stage='discovery'", async () => {
    const { openPipeline } = await import("./pipeline");
    const { pipelineId } = await openPipeline({
      pipelineKind: "improvement",
      triggeringSourceKind: "team_improvement_opportunity",
      triggeringSourceId: "opp-42",
      improvementOpportunityId: 42,
    });
    expect(pipelineId).toBe(1);
    expect(ROWS[0].currentStage).toBe("discovery");
    expect(ROWS[0].pipelineKind).toBe("improvement");
    expect(ROWS[0].improvementOpportunityId).toBe(42);
  });

  it("rejects invalid pipelineKind", async () => {
    const { openPipeline } = await import("./pipeline");
    await expect(
      openPipeline({
        // @ts-expect-error — intentionally invalid
        pipelineKind: "not-a-kind",
      }),
    ).rejects.toThrow(/invalid pipelineKind/);
  });
});

// ---------------------------------------------------------------------------
// Full happy path
// ---------------------------------------------------------------------------

describe("pipeline full happy path", () => {
  it("open → decision → dispatch → delivery → close with all durations recorded", async () => {
    const {
      openPipeline,
      advanceToDecision,
      advanceToDispatch,
      advanceToDelivery,
      closePipeline,
      getPipeline,
    } = await import("./pipeline");

    const { pipelineId } = await openPipeline({
      pipelineKind: "improvement",
    });

    // Reach in and backdate createdAt so durations are nonzero.
    const row = ROWS[0];
    row.createdAt = new Date(Date.now() - 60_000);

    await advanceToDecision({ pipelineId, planProposalId: 100 });
    const afterDecision = await getPipeline(pipelineId);
    expect(afterDecision?.currentStage).toBe("decision");
    expect(afterDecision?.planProposalId).toBe(100);
    expect(afterDecision?.durationMsDiscoveryToDecision).toBeGreaterThan(0);

    // Force decisionEnteredAt earlier so dispatch duration is nonzero.
    row.updatedAt = new Date(Date.now() - 30_000);

    await advanceToDispatch({ pipelineId, dispatchId: 200 });
    const afterDispatch = await getPipeline(pipelineId);
    expect(afterDispatch?.currentStage).toBe("dispatch");
    expect(afterDispatch?.dispatchId).toBe(200);
    expect(afterDispatch?.durationMsDecisionToDispatch).toBeGreaterThanOrEqual(
      0,
    );

    await advanceToDelivery({ pipelineId, reviewDispatchId: 300 });
    const afterDelivery = await getPipeline(pipelineId);
    expect(afterDelivery?.currentStage).toBe("delivery");
    expect(afterDelivery?.reviewDispatchId).toBe(300);
    expect(afterDelivery?.durationMsDispatchToDelivery).toBeGreaterThanOrEqual(
      0,
    );

    await closePipeline({
      pipelineId,
      outcome: "shipped",
      notes: "all good",
    });
    const closed = await getPipeline(pipelineId);
    expect(closed?.currentStage).toBe("completed");
    expect(closed?.finalOutcome).toBe("shipped");
    expect(closed?.finalOutcomeNotes).toBe("all good");
  });
});

// ---------------------------------------------------------------------------
// Skip-decision path
// ---------------------------------------------------------------------------

describe("pipeline skip-decision shortcut", () => {
  it("open → dispatch (skip decision) → delivery → close, durationMsDecisionToDispatch stays null", async () => {
    const {
      openPipeline,
      advanceToDispatch,
      advanceToDelivery,
      closePipeline,
      getPipeline,
    } = await import("./pipeline");

    const { pipelineId } = await openPipeline({
      pipelineKind: "external_watch",
    });

    await advanceToDispatch({ pipelineId, dispatchId: 999 });
    const afterDispatch = await getPipeline(pipelineId);
    expect(afterDispatch?.currentStage).toBe("dispatch");
    expect(afterDispatch?.dispatchId).toBe(999);
    expect(afterDispatch?.durationMsDiscoveryToDecision).toBeNull();
    expect(afterDispatch?.durationMsDecisionToDispatch).toBeNull();

    await advanceToDelivery({ pipelineId });
    const afterDelivery = await getPipeline(pipelineId);
    expect(afterDelivery?.currentStage).toBe("delivery");
    expect(afterDelivery?.durationMsDispatchToDelivery).not.toBeNull();
    expect(afterDelivery?.reviewDispatchId).toBeNull();

    await closePipeline({ pipelineId, outcome: "shipped" });
    expect((await getPipeline(pipelineId))?.currentStage).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// Invalid transitions
// ---------------------------------------------------------------------------

describe("pipeline invalid transitions", () => {
  it("discovery → delivery directly throws", async () => {
    const { openPipeline, advanceToDelivery } = await import("./pipeline");
    const { pipelineId } = await openPipeline({
      pipelineKind: "improvement",
    });
    await expect(advanceToDelivery({ pipelineId })).rejects.toThrow(
      /only 'dispatch' can advance to 'delivery'/,
    );
  });

  it("decision → delivery directly throws", async () => {
    const { openPipeline, advanceToDecision, advanceToDelivery } =
      await import("./pipeline");
    const { pipelineId } = await openPipeline({
      pipelineKind: "improvement",
    });
    await advanceToDecision({ pipelineId, planProposalId: 1 });
    await expect(advanceToDelivery({ pipelineId })).rejects.toThrow(
      /only 'dispatch' can advance to 'delivery'/,
    );
  });

  it("delivery → decision throws (no going backward)", async () => {
    const {
      openPipeline,
      advanceToDispatch,
      advanceToDelivery,
      advanceToDecision,
    } = await import("./pipeline");
    const { pipelineId } = await openPipeline({
      pipelineKind: "improvement",
    });
    await advanceToDispatch({ pipelineId, dispatchId: 1 });
    await advanceToDelivery({ pipelineId });
    await expect(
      advanceToDecision({ pipelineId, planProposalId: 1 }),
    ).rejects.toThrow(/only 'discovery' can advance to 'decision'/);
  });

  it("advanceToDecision on nonexistent id throws", async () => {
    const { advanceToDecision } = await import("./pipeline");
    await expect(
      advanceToDecision({ pipelineId: 9999, planProposalId: 1 }),
    ).rejects.toThrow(/not found/);
  });
});

// ---------------------------------------------------------------------------
// closePipeline
// ---------------------------------------------------------------------------

describe("pipeline.closePipeline", () => {
  async function bringToDelivery() {
    const { openPipeline, advanceToDispatch, advanceToDelivery } =
      await import("./pipeline");
    const { pipelineId } = await openPipeline({
      pipelineKind: "improvement",
    });
    await advanceToDispatch({ pipelineId, dispatchId: 1 });
    await advanceToDelivery({ pipelineId });
    return pipelineId;
  }

  it("accepts all four outcomes", async () => {
    const { closePipeline, getPipeline } = await import("./pipeline");
    for (const outcome of [
      "shipped",
      "flagged_and_recovered",
      "abandoned",
      "superseded",
    ] as const) {
      const id = await bringToDelivery();
      await closePipeline({ pipelineId: id, outcome });
      const row = await getPipeline(id);
      expect(row?.currentStage).toBe("completed");
      expect(row?.finalOutcome).toBe(outcome);
    }
  });

  it("rejects invalid outcome", async () => {
    const { closePipeline } = await import("./pipeline");
    const id = await bringToDelivery();
    await expect(
      closePipeline({
        pipelineId: id,
        // @ts-expect-error — intentionally invalid
        outcome: "bogus",
      }),
    ).rejects.toThrow(/invalid outcome/);
  });

  it("requires stage='delivery'", async () => {
    const { openPipeline, closePipeline } = await import("./pipeline");
    const { pipelineId } = await openPipeline({
      pipelineKind: "improvement",
    });
    await expect(
      closePipeline({ pipelineId, outcome: "shipped" }),
    ).rejects.toThrow(/only 'delivery' can close/);
  });
});

// ---------------------------------------------------------------------------
// abandonPipeline
// ---------------------------------------------------------------------------

describe("pipeline.abandonPipeline", () => {
  it("sets stage='abandoned', final_outcome='abandoned', notes=reason", async () => {
    const { openPipeline, abandonPipeline, getPipeline } = await import(
      "./pipeline"
    );
    const { pipelineId } = await openPipeline({
      pipelineKind: "improvement",
    });
    await abandonPipeline(pipelineId, "scope wrong");
    const row = await getPipeline(pipelineId);
    expect(row?.currentStage).toBe("abandoned");
    expect(row?.finalOutcome).toBe("abandoned");
    expect(row?.finalOutcomeNotes).toBe("scope wrong");
  });

  it("rejects empty reason", async () => {
    const { openPipeline, abandonPipeline } = await import("./pipeline");
    const { pipelineId } = await openPipeline({
      pipelineKind: "improvement",
    });
    await expect(abandonPipeline(pipelineId, "  ")).rejects.toThrow(
      /reason required/,
    );
  });

  it("cannot abandon a terminal pipeline", async () => {
    const {
      openPipeline,
      advanceToDispatch,
      advanceToDelivery,
      closePipeline,
      abandonPipeline,
    } = await import("./pipeline");
    const { pipelineId } = await openPipeline({
      pipelineKind: "improvement",
    });
    await advanceToDispatch({ pipelineId, dispatchId: 1 });
    await advanceToDelivery({ pipelineId });
    await closePipeline({ pipelineId, outcome: "shipped" });
    await expect(abandonPipeline(pipelineId, "too late")).rejects.toThrow(
      /terminal stage=completed/,
    );
  });
});

// ---------------------------------------------------------------------------
// listPipelines + getPipeline
// ---------------------------------------------------------------------------

describe("pipeline.listPipelines", () => {
  it("filters by stage, kind, and respects limit", async () => {
    const { openPipeline, advanceToDispatch, listPipelines } = await import(
      "./pipeline"
    );
    const a = await openPipeline({ pipelineKind: "improvement" });
    const b = await openPipeline({ pipelineKind: "external_watch" });
    const c = await openPipeline({ pipelineKind: "improvement" });
    await advanceToDispatch({ pipelineId: c.pipelineId, dispatchId: 1 });

    const improvementOnly = await listPipelines({ kind: "improvement" });
    expect(improvementOnly).toHaveLength(2);

    const discoveryOnly = await listPipelines({ stage: "discovery" });
    expect(discoveryOnly).toHaveLength(2);
    expect(discoveryOnly.map((p) => p.id).sort()).toEqual(
      [a.pipelineId, b.pipelineId].sort(),
    );

    const both = await listPipelines({
      stage: "dispatch",
      kind: "improvement",
    });
    expect(both).toHaveLength(1);
    expect(both[0].id).toBe(c.pipelineId);

    const limited = await listPipelines({ limit: 2 });
    expect(limited.length).toBeLessThanOrEqual(2);
  });
});

describe("pipeline.getPipeline", () => {
  it("returns null for nonexistent id", async () => {
    const { getPipeline } = await import("./pipeline");
    const row = await getPipeline(424242);
    expect(row).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getFunnelSummary
// ---------------------------------------------------------------------------

describe("pipeline.getFunnelSummary", () => {
  it("counts by stage, kind, outcome and computes averages skipping nulls", async () => {
    const {
      openPipeline,
      advanceToDispatch,
      advanceToDelivery,
      closePipeline,
      abandonPipeline,
      getFunnelSummary,
    } = await import("./pipeline");

    // pipeline 1: full lifecycle, improvement, shipped
    const p1 = await openPipeline({ pipelineKind: "improvement" });
    ROWS[0].createdAt = new Date(Date.now() - 120_000);
    await advanceToDispatch({ pipelineId: p1.pipelineId, dispatchId: 1 });
    await advanceToDelivery({ pipelineId: p1.pipelineId });
    await closePipeline({ pipelineId: p1.pipelineId, outcome: "shipped" });

    // pipeline 2: stuck at discovery, external_watch
    await openPipeline({ pipelineKind: "external_watch" });

    // pipeline 3: abandoned at dispatch, founder_request
    const p3 = await openPipeline({ pipelineKind: "founder_request" });
    await advanceToDispatch({ pipelineId: p3.pipelineId, dispatchId: 2 });
    await abandonPipeline(p3.pipelineId, "founder canceled");

    const funnel = await getFunnelSummary(30);

    expect(funnel.byStage.completed).toBe(1);
    expect(funnel.byStage.discovery).toBe(1);
    expect(funnel.byStage.abandoned).toBe(1);
    expect(funnel.byStage.dispatch).toBe(0);

    expect(funnel.byKind.improvement).toBe(1);
    expect(funnel.byKind.external_watch).toBe(1);
    expect(funnel.byKind.founder_request).toBe(1);

    expect(funnel.byOutcome.shipped).toBe(1);
    expect(funnel.byOutcome.abandoned).toBe(1);
    expect(funnel.byOutcome.flagged_and_recovered).toBe(0);

    // p1 took skip-decision path so discoveryToDecision + decisionToDispatch
    // both null; only dispatchToDelivery measured.
    expect(funnel.averageDurationMs.discoveryToDecision).toBeNull();
    expect(funnel.averageDurationMs.decisionToDispatch).toBeNull();
    expect(funnel.averageDurationMs.dispatchToDelivery).not.toBeNull();
    expect(funnel.averageDurationMs.discoveryToDelivery).not.toBeNull();
  });

  it("rejects non-positive windowDays", async () => {
    const { getFunnelSummary } = await import("./pipeline");
    await expect(getFunnelSummary(0)).rejects.toThrow(/must be > 0/);
    await expect(getFunnelSummary(-1)).rejects.toThrow(/must be > 0/);
  });
});
