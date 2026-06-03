/**
 * Tests for Solene plan-then-execute proposal service (Phase B L2.6).
 *
 * Coverage:
 *  - proposePlan happy path returns id
 *  - proposePlan rejects summary above max
 *  - proposePlan rejects invalid agentRole
 *  - proposePlan rejects non-positive estimatedCostUsd
 *  - listPendingPlans filters by agentRole + limit
 *  - approvePlan without enqueueOptions → status='approved', no enqueue
 *  - approvePlan with enqueueOptions → enqueueDispatch called → status='executed'
 *  - approvePlan enqueueDispatch throws → status stays 'approved', no rethrow
 *  - rejectPlan → status='rejected' + rationale persisted
 *  - rejectPlan requires non-empty rationale
 *  - getProposal returns null for missing id (404 case)
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

interface ProposalRow {
  id: number;
  proposedAt: Date;
  agentRole: string;
  triggeringDispatchId: number | null;
  summary: string;
  planBody: string;
  estimatedCostUsd: string;
  estimatedDurationMinutes: number;
  riskAssessment: string | null;
  status: string;
  decidedAt: Date | null;
  decidedBy: string | null;
  decisionRationale: string | null;
  executedDispatchId: number | null;
}

const PROPOSALS: ProposalRow[] = [];
let nextId = 1;

// Tracks where-clause filters the service emits, so the in-memory mock can
// answer them. Drizzle's eq() / and() are intercepted below.
type WhereTag =
  | { kind: "by-id"; id: number }
  | { kind: "by-status"; status: string }
  | { kind: "by-status-and-role"; status: string; agentRole: string };

vi.mock("../../db", () => {
  const db = {
    insert: (_table: unknown) => ({
      values: (row: any) => ({
        returning: async (_cols: any) => {
          const created: ProposalRow = {
            id: nextId++,
            proposedAt: new Date(),
            agentRole: row.agentRole,
            triggeringDispatchId: row.triggeringDispatchId ?? null,
            summary: row.summary,
            planBody: row.planBody,
            estimatedCostUsd: row.estimatedCostUsd,
            estimatedDurationMinutes: row.estimatedDurationMinutes,
            riskAssessment: row.riskAssessment ?? null,
            status: row.status ?? "proposed",
            decidedAt: null,
            decidedBy: null,
            decisionRationale: null,
            executedDispatchId: null,
          };
          PROPOSALS.push(created);
          return [{ id: created.id }];
        },
      }),
    }),
    update: (_table: unknown) => ({
      set: (patch: any) => ({
        where: async (clause: WhereTag) => {
          if (clause?.kind !== "by-id") return;
          const row = PROPOSALS.find((p) => p.id === clause.id);
          if (!row) return;
          if (patch.status !== undefined) row.status = patch.status;
          if (patch.decidedAt !== undefined) row.decidedAt = patch.decidedAt;
          if (patch.decidedBy !== undefined) row.decidedBy = patch.decidedBy;
          if (patch.decisionRationale !== undefined)
            row.decisionRationale = patch.decisionRationale;
          if (patch.executedDispatchId !== undefined)
            row.executedDispatchId = patch.executedDispatchId;
        },
      }),
    }),
    select: (_cols?: any) => ({
      from: (_t: unknown) => ({
        where: (clause: WhereTag) => {
          function matchingRows(): ProposalRow[] {
            if (clause?.kind === "by-id") {
              return PROPOSALS.filter((p) => p.id === clause.id);
            }
            if (clause?.kind === "by-status") {
              return PROPOSALS.filter((p) => p.status === clause.status);
            }
            if (clause?.kind === "by-status-and-role") {
              return PROPOSALS.filter(
                (p) =>
                  p.status === clause.status &&
                  p.agentRole === clause.agentRole,
              );
            }
            return [];
          }
          return {
            orderBy: (_o: any) => ({
              limit: async (n: number) => {
                const rows = matchingRows()
                  .slice()
                  .sort(
                    (a, b) =>
                      b.proposedAt.getTime() - a.proposedAt.getTime(),
                  )
                  .slice(0, n);
                return rows;
              },
            }),
            limit: async (n: number) => matchingRows().slice(0, n),
          };
        },
      }),
    }),
  };
  return { db };
});

// Stub drizzle eq/and to emit our where-tag shape.
vi.mock("drizzle-orm", async () => {
  const actual =
    await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (col: any, val: any) => {
      const name = col?.name ?? col?.fieldAlias ?? "";
      if (name === "id") return { kind: "by-id", id: val };
      if (name === "status") return { __field: "status", value: val };
      if (name === "agent_role")
        return { __field: "agent_role", value: val };
      return { __field: name, value: val };
    },
    and: (...parts: any[]) => {
      // Recognize (status, agent_role) AND pair used in listPendingPlans /
      // routes list-by-status.
      const status = parts.find((p) => p?.__field === "status")?.value;
      const role = parts.find((p) => p?.__field === "agent_role")?.value;
      if (status && role)
        return { kind: "by-status-and-role", status, agentRole: role };
      return parts[0];
    },
    desc: (col: any) => ({ __desc: col }),
  };
});

// Stub enqueueDispatch — default success, override per test.
const enqueueDispatchMock = vi.fn(async (_opts: any) => 42);
vi.mock("./dispatchQueue", () => ({
  enqueueDispatch: (opts: any) => enqueueDispatchMock(opts),
}));

// Translate the simple eq-on-status path used by listPendingPlans (no role).
vi.mock("@shared/schema/solene-plan-proposals", async () => {
  const actual = await vi.importActual<
    typeof import("@shared/schema/solene-plan-proposals")
  >("@shared/schema/solene-plan-proposals");
  // Re-export with column descriptors the eq() stub above can read.
  return {
    ...actual,
    planProposals: {
      ...actual.planProposals,
      id: { name: "id" },
      status: { name: "status" },
      agentRole: { name: "agent_role" },
      proposedAt: { name: "proposed_at" },
    },
  };
});

beforeEach(() => {
  PROPOSALS.length = 0;
  nextId = 1;
  enqueueDispatchMock.mockReset();
  enqueueDispatchMock.mockResolvedValue(42);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("planProposals.proposePlan", () => {
  it("happy path returns id", async () => {
    const { proposePlan } = await import("./planProposals");
    const result = await proposePlan({
      agentRole: "iris",
      summary: "wire L2.6 founder route",
      planBody: "1. write schema\n2. service\n3. routes\n4. tests",
      estimatedCostUsd: 5,
      estimatedDurationMinutes: 30,
    });
    expect(result.proposalId).toBe(1);
    expect(PROPOSALS).toHaveLength(1);
    expect(PROPOSALS[0].status).toBe("proposed");
    expect(PROPOSALS[0].agentRole).toBe("iris");
  });

  it("rejects summary above max length", async () => {
    const { proposePlan } = await import("./planProposals");
    await expect(
      proposePlan({
        agentRole: "iris",
        summary: "x".repeat(501),
        planBody: "p",
        estimatedCostUsd: 1,
        estimatedDurationMinutes: 1,
      }),
    ).rejects.toThrow(/exceeds max/);
  });

  it("rejects invalid agentRole", async () => {
    const { proposePlan } = await import("./planProposals");
    await expect(
      proposePlan({
        // @ts-expect-error — intentionally invalid
        agentRole: "not-an-agent",
        summary: "x",
        planBody: "p",
        estimatedCostUsd: 1,
        estimatedDurationMinutes: 1,
      }),
    ).rejects.toThrow(/invalid agentRole/);
  });

  it("rejects non-positive estimatedCostUsd", async () => {
    const { proposePlan } = await import("./planProposals");
    await expect(
      proposePlan({
        agentRole: "iris",
        summary: "x",
        planBody: "p",
        estimatedCostUsd: 0,
        estimatedDurationMinutes: 1,
      }),
    ).rejects.toThrow(/must be > 0/);
  });
});

describe("planProposals.listPendingPlans", () => {
  it("filters by agentRole and respects limit", async () => {
    const { proposePlan, listPendingPlans } = await import("./planProposals");
    await proposePlan({
      agentRole: "iris",
      summary: "a",
      planBody: "p",
      estimatedCostUsd: 1,
      estimatedDurationMinutes: 1,
    });
    await proposePlan({
      agentRole: "soren",
      summary: "b",
      planBody: "p",
      estimatedCostUsd: 1,
      estimatedDurationMinutes: 1,
    });
    await proposePlan({
      agentRole: "iris",
      summary: "c",
      planBody: "p",
      estimatedCostUsd: 1,
      estimatedDurationMinutes: 1,
    });

    const irisRows = await listPendingPlans({ agentRole: "iris" });
    expect(irisRows).toHaveLength(2);
    expect(irisRows.every((r) => r.agentRole === "iris")).toBe(true);

    const limited = await listPendingPlans({ agentRole: "iris", limit: 1 });
    expect(limited).toHaveLength(1);
  });
});

describe("planProposals.approvePlan", () => {
  it("without enqueueOptions → status='approved', no enqueue", async () => {
    const { proposePlan, approvePlan, getProposal } = await import(
      "./planProposals"
    );
    const { proposalId } = await proposePlan({
      agentRole: "iris",
      summary: "x",
      planBody: "p",
      estimatedCostUsd: 1,
      estimatedDurationMinutes: 1,
    });
    const result = await approvePlan(proposalId, {
      decidedBy: "tom",
      decisionRationale: "looks reasonable",
    });
    expect(result.executedDispatchId).toBeUndefined();
    expect(enqueueDispatchMock).not.toHaveBeenCalled();
    const row = await getProposal(proposalId);
    expect(row?.status).toBe("approved");
    expect(row?.decidedBy).toBe("tom");
    expect(row?.decisionRationale).toBe("looks reasonable");
    expect(row?.executedDispatchId).toBeNull();
  });

  it("with enqueueOptions → enqueueDispatch called → status='executed' with executed_dispatch_id", async () => {
    const { proposePlan, approvePlan, getProposal } = await import(
      "./planProposals"
    );
    enqueueDispatchMock.mockResolvedValueOnce(777);
    const { proposalId } = await proposePlan({
      agentRole: "iris",
      summary: "x",
      planBody: "p",
      estimatedCostUsd: 1,
      estimatedDurationMinutes: 1,
    });
    const result = await approvePlan(proposalId, {
      decidedBy: "tom",
      enqueueOptions: {
        sourceType: "founder_manual",
        sourceId: "founder:tom",
        promptText: "execute the approved plan",
      },
    });
    expect(result.executedDispatchId).toBe(777);
    expect(enqueueDispatchMock).toHaveBeenCalledTimes(1);
    expect(enqueueDispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: "founder_manual",
        sourceId: "founder:tom",
        agentRole: "iris",
        promptText: "execute the approved plan",
        enqueuedBy: `plan-proposal:${proposalId}`,
      }),
    );
    const row = await getProposal(proposalId);
    expect(row?.status).toBe("executed");
    expect(row?.executedDispatchId).toBe(777);
  });

  it("enqueueDispatch throws → status stays 'approved', no rethrow", async () => {
    const { proposePlan, approvePlan, getProposal } = await import(
      "./planProposals"
    );
    enqueueDispatchMock.mockRejectedValueOnce(new Error("cost cap exceeded"));
    const { proposalId } = await proposePlan({
      agentRole: "iris",
      summary: "x",
      planBody: "p",
      estimatedCostUsd: 1,
      estimatedDurationMinutes: 1,
    });
    const result = await approvePlan(proposalId, {
      decidedBy: "tom",
      enqueueOptions: {
        sourceType: "founder_manual",
        sourceId: "founder:tom",
        promptText: "execute",
      },
    });
    expect(result.executedDispatchId).toBeUndefined();
    const row = await getProposal(proposalId);
    expect(row?.status).toBe("approved");
    expect(row?.executedDispatchId).toBeNull();
  });
});

describe("planProposals.rejectPlan", () => {
  it("sets status='rejected' and persists rationale", async () => {
    const { proposePlan, rejectPlan, getProposal } = await import(
      "./planProposals"
    );
    const { proposalId } = await proposePlan({
      agentRole: "iris",
      summary: "x",
      planBody: "p",
      estimatedCostUsd: 1,
      estimatedDurationMinutes: 1,
    });
    await rejectPlan(proposalId, {
      decidedBy: "tom",
      decisionRationale: "scope too broad",
    });
    const row = await getProposal(proposalId);
    expect(row?.status).toBe("rejected");
    expect(row?.decisionRationale).toBe("scope too broad");
    expect(row?.decidedBy).toBe("tom");
  });

  it("requires non-empty rationale", async () => {
    const { proposePlan, rejectPlan } = await import("./planProposals");
    const { proposalId } = await proposePlan({
      agentRole: "iris",
      summary: "x",
      planBody: "p",
      estimatedCostUsd: 1,
      estimatedDurationMinutes: 1,
    });
    await expect(
      rejectPlan(proposalId, { decidedBy: "tom", decisionRationale: "  " }),
    ).rejects.toThrow(/decisionRationale required/);
  });
});

describe("planProposals.getProposal", () => {
  it("returns null for missing id (404 case)", async () => {
    const { getProposal } = await import("./planProposals");
    const row = await getProposal(9999);
    expect(row).toBeNull();
  });
});
