/**
 * Tests for SOLENE capability discovery (Phase B L5.24).
 *
 * Coverage:
 *  - proposeCapability happy path + ROI compute when all 3 inputs present
 *  - proposeCapability invalid name → throw with helpful message
 *  - proposeCapability problemStatement > 2000 → truncate
 *  - proposeCapability proposedToolSignature > 1000 → truncate
 *  - proposeCapability low-ROI → warn-log (ROI < 1.0)
 *  - decideOnProposal accepted/deferred/rejected
 *  - decideOnProposal on already-decided → throw
 *  - decideOnProposal invalid decision → throw
 *  - markImplemented on non-accepted → throw
 *  - markImplemented happy path
 *  - listProposalsByStatus filter
 *  - recordIntrospection + getLatestIntrospection
 *  - rankProposalsByROI: 3 proposals with known numbers → expected order
 *  - rankProposalsByROI: missing fields → row skipped (not crashed)
 *  - findDuplicateProposals: similar pair flagged; dissimilar pair not
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

interface ProposalRow {
  id: number;
  proposedAt: Date;
  proposingAgentRole: string;
  proposedCapabilityName: string;
  problemStatement: string;
  proposedToolSignature: string;
  expectedValueUsd: string | null;
  expectedInvocationsPerWeek: number | null;
  estimatedBuildCostUsd: string | null;
  referencesExistingTools: string[] | null;
  status: string;
  decidedAt: Date | null;
  decidedBy: string | null;
  decisionRationale: string | null;
  implementingDispatchId: number | null;
}

interface IntrospectionRow {
  id: number;
  introspectedAt: Date;
  agentRole: string;
  availableTools: unknown;
  gapSignals: unknown;
}

const PROPOSAL_ROWS: ProposalRow[] = [];
const INTROSPECTION_ROWS: IntrospectionRow[] = [];
let nextProposalId = 1;
let nextIntrospectionId = 1;

interface PredInfo {
  table?: "proposals" | "introspections";
  idEq?: number;
  statusEq?: string;
  agentRoleEq?: string;
}

function parseWhere(pred: any): PredInfo {
  const info: PredInfo = {};
  walk(pred);
  return info;
  function walk(node: any) {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const c of node) walk(c);
      return;
    }
    if (typeof node === "object") {
      if (node.op === "eq") {
        if (node.col === "id") info.idEq = node.val;
        else if (node.col === "status") info.statusEq = node.val;
        else if (node.col === "agent_role") info.agentRoleEq = node.val;
      } else if (Array.isArray(node.preds)) {
        for (const c of node.preds) walk(c);
      }
    }
  }
}

function buildDbMock() {
  let pendingTable: "proposals" | "introspections" | null = null;
  let pendingIdEq: number | undefined;
  let pendingStatusEq: string | undefined;
  let pendingAgentRoleEq: string | undefined;
  let pendingOrderDesc: "proposed_at" | "introspected_at" | null = null;
  let pendingLimit: number | undefined;

  const reset = () => {
    pendingTable = null;
    pendingIdEq = undefined;
    pendingStatusEq = undefined;
    pendingAgentRoleEq = undefined;
    pendingOrderDesc = null;
    pendingLimit = undefined;
  };

  const chain: any = {
    from(table: any) {
      pendingTable =
        table?.__tableName === "introspections"
          ? "introspections"
          : "proposals";
      return chain;
    },
    where(pred: any) {
      const info = parseWhere(pred);
      pendingIdEq = info.idEq;
      pendingStatusEq = info.statusEq;
      pendingAgentRoleEq = info.agentRoleEq;
      return chain;
    },
    orderBy(arg: any) {
      const col = arg?.col?.name ?? arg?.col;
      if (col === "introspected_at") pendingOrderDesc = "introspected_at";
      else pendingOrderDesc = "proposed_at";
      return chain;
    },
    limit(n: number) {
      pendingLimit = n;
      return chain;
    },
    then(onFulfilled: any, onRejected: any) {
      let out: any[];
      if (pendingTable === "introspections") {
        let rows = [...INTROSPECTION_ROWS];
        if (pendingAgentRoleEq !== undefined) {
          rows = rows.filter((r) => r.agentRole === pendingAgentRoleEq);
        }
        if (pendingIdEq !== undefined) {
          rows = rows.filter((r) => r.id === pendingIdEq);
        }
        if (pendingOrderDesc === "introspected_at") {
          rows.sort(
            (a, b) => b.introspectedAt.getTime() - a.introspectedAt.getTime(),
          );
        }
        if (pendingLimit !== undefined) rows = rows.slice(0, pendingLimit);
        out = rows;
      } else {
        let rows = [...PROPOSAL_ROWS];
        if (pendingIdEq !== undefined) {
          rows = rows.filter((r) => r.id === pendingIdEq);
        }
        if (pendingStatusEq !== undefined) {
          rows = rows.filter((r) => r.status === pendingStatusEq);
        }
        if (pendingOrderDesc === "proposed_at") {
          rows.sort(
            (a, b) => b.proposedAt.getTime() - a.proposedAt.getTime(),
          );
        }
        if (pendingLimit !== undefined) rows = rows.slice(0, pendingLimit);
        out = rows;
      }
      reset();
      return Promise.resolve(out).then(onFulfilled, onRejected);
    },
  };

  return {
    insert: (table: any) => ({
      values: (row: any) => ({
        returning: async () => {
          if (table?.__tableName === "introspections") {
            const created: IntrospectionRow = {
              id: nextIntrospectionId++,
              introspectedAt: new Date(),
              agentRole: row.agentRole,
              availableTools: row.availableTools,
              gapSignals: row.gapSignals,
            };
            INTROSPECTION_ROWS.push(created);
            return [{ id: created.id }];
          }
          const created: ProposalRow = {
            id: nextProposalId++,
            proposedAt: new Date(),
            proposingAgentRole: row.proposingAgentRole,
            proposedCapabilityName: row.proposedCapabilityName,
            problemStatement: row.problemStatement,
            proposedToolSignature: row.proposedToolSignature,
            expectedValueUsd: row.expectedValueUsd ?? null,
            expectedInvocationsPerWeek: row.expectedInvocationsPerWeek ?? null,
            estimatedBuildCostUsd: row.estimatedBuildCostUsd ?? null,
            referencesExistingTools: row.referencesExistingTools ?? null,
            status: row.status ?? "proposed",
            decidedAt: null,
            decidedBy: null,
            decisionRationale: null,
            implementingDispatchId: null,
          };
          PROPOSAL_ROWS.push(created);
          return [{ id: created.id }];
        },
      }),
    }),
    update: (_table: any) => ({
      set: (patch: any) => ({
        where: async (pred: any) => {
          const info = parseWhere(pred);
          if (info.idEq === undefined) return;
          const row = PROPOSAL_ROWS.find((r) => r.id === info.idEq);
          if (!row) return;
          if (patch.status !== undefined) row.status = patch.status;
          if (patch.decidedAt !== undefined) row.decidedAt = patch.decidedAt;
          if (patch.decidedBy !== undefined) row.decidedBy = patch.decidedBy;
          if (patch.decisionRationale !== undefined)
            row.decisionRationale = patch.decisionRationale;
          if (patch.implementingDispatchId !== undefined)
            row.implementingDispatchId = patch.implementingDispatchId;
        },
      }),
    }),
    select: () => chain,
  };
}

vi.mock("../../db", () => ({ db: buildDbMock() }));

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>(
    "drizzle-orm",
  );
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
    asc: (col: any) => ({ op: "asc", col }),
    desc: (col: any) => ({ op: "desc", col }),
  };
});

vi.mock("@shared/schema/solene-capability-proposals", () => ({
  soleneCapabilityProposals: {
    __tableName: "proposals",
    id: { name: "id" },
    proposedAt: { name: "proposed_at" },
    proposingAgentRole: { name: "proposing_agent_role" },
    proposedCapabilityName: { name: "proposed_capability_name" },
    problemStatement: { name: "problem_statement" },
    proposedToolSignature: { name: "proposed_tool_signature" },
    expectedValueUsd: { name: "expected_value_usd" },
    expectedInvocationsPerWeek: { name: "expected_invocations_per_week" },
    estimatedBuildCostUsd: { name: "estimated_build_cost_usd" },
    referencesExistingTools: { name: "references_existing_tools" },
    status: { name: "status" },
    decidedAt: { name: "decided_at" },
    decidedBy: { name: "decided_by" },
    decisionRationale: { name: "decision_rationale" },
    implementingDispatchId: { name: "implementing_dispatch_id" },
  },
  soleneCapabilityIntrospections: {
    __tableName: "introspections",
    id: { name: "id" },
    introspectedAt: { name: "introspected_at" },
    agentRole: { name: "agent_role" },
    availableTools: { name: "available_tools" },
    gapSignals: { name: "gap_signals" },
  },
  CAPABILITY_NAME_PATTERN: /^[a-z][a-z0-9_]{2,49}$/,
  CAPABILITY_PROPOSAL_STATUSES: [
    "proposed",
    "accepted",
    "deferred",
    "rejected",
    "implemented",
  ],
  PROBLEM_STATEMENT_MAX_CHARS: 2000,
  TOOL_SIGNATURE_MAX_CHARS: 1000,
  TRUNCATION_SUFFIX: "… [truncated]",
  DUPLICATE_SIMILARITY_THRESHOLD: 0.6,
}));

vi.mock("@shared/schema/solene-dispatch", () => ({
  DISPATCH_AGENT_ROLES: [
    "iris",
    "soren",
    "beatrice",
    "krieger",
    "general-purpose",
    "code-reviewer",
  ],
}));

import { logger } from "../../utils/logger";
import {
  proposeCapability,
  decideOnProposal,
  markImplemented,
  listProposalsByStatus,
  recordIntrospection,
  getLatestIntrospection,
  rankProposalsByROI,
  findDuplicateProposals,
} from "./capabilityDiscovery";

beforeEach(() => {
  PROPOSAL_ROWS.length = 0;
  INTROSPECTION_ROWS.length = 0;
  nextProposalId = 1;
  nextIntrospectionId = 1;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────────────
// proposeCapability
// ────────────────────────────────────────────────────────────────────────

describe("proposeCapability", () => {
  it("happy path inserts a proposal with the provided fields", async () => {
    const result = await proposeCapability({
      proposingAgentRole: "iris",
      proposedCapabilityName: "fly_log_search",
      problemStatement: "Frequently need to grep fly logs by request ID.",
      proposedToolSignature:
        "flyLogSearch(appName: string, requestId: string): Promise<LogLine[]>",
      expectedValueUsd: 2.5,
      expectedInvocationsPerWeek: 20,
      estimatedBuildCostUsd: 50,
    });
    expect(result.proposalId).toBe(1);
    expect(PROPOSAL_ROWS).toHaveLength(1);
    expect(PROPOSAL_ROWS[0]!.status).toBe("proposed");
    expect(PROPOSAL_ROWS[0]!.proposedCapabilityName).toBe("fly_log_search");
    expect(PROPOSAL_ROWS[0]!.expectedValueUsd).toBe("2.5000");
    expect(PROPOSAL_ROWS[0]!.expectedInvocationsPerWeek).toBe(20);
    expect(PROPOSAL_ROWS[0]!.estimatedBuildCostUsd).toBe("50.0000");
    // ROI = (2.5 * 20 * 52) / 50 = 52 → high, no warn.
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("warns when ROI < 1.0", async () => {
    await proposeCapability({
      proposingAgentRole: "iris",
      proposedCapabilityName: "expensive_tool",
      problemStatement: "Rare use case.",
      proposedToolSignature: "expensiveTool(): void",
      expectedValueUsd: 0.1,
      expectedInvocationsPerWeek: 1,
      estimatedBuildCostUsd: 1000,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("low-ROI proposal"),
    );
  });

  it("throws on invalid (non-snake_case) name", async () => {
    await expect(
      proposeCapability({
        proposingAgentRole: "iris",
        proposedCapabilityName: "BadName",
        problemStatement: "x",
        proposedToolSignature: "y",
      }),
    ).rejects.toThrow(/snake_case/);
  });

  it("throws on too-short name", async () => {
    await expect(
      proposeCapability({
        proposingAgentRole: "iris",
        proposedCapabilityName: "ab",
        problemStatement: "x",
        proposedToolSignature: "y",
      }),
    ).rejects.toThrow(/snake_case/);
  });

  it("throws on invalid agent role", async () => {
    await expect(
      proposeCapability({
        // @ts-expect-error testing invalid role
        proposingAgentRole: "not-a-real-role",
        proposedCapabilityName: "fine_name",
        problemStatement: "x",
        proposedToolSignature: "y",
      }),
    ).rejects.toThrow(/proposingAgentRole/);
  });

  it("truncates problemStatement > 2000 chars", async () => {
    const longText = "a".repeat(2500);
    await proposeCapability({
      proposingAgentRole: "soren",
      proposedCapabilityName: "ok_name",
      problemStatement: longText,
      proposedToolSignature: "sig()",
    });
    const row = PROPOSAL_ROWS[0]!;
    expect(row.problemStatement.length).toBeLessThanOrEqual(2000);
    expect(row.problemStatement.endsWith("… [truncated]")).toBe(true);
  });

  it("truncates proposedToolSignature > 1000 chars", async () => {
    const longSig = "b".repeat(1500);
    await proposeCapability({
      proposingAgentRole: "soren",
      proposedCapabilityName: "ok_name",
      problemStatement: "p",
      proposedToolSignature: longSig,
    });
    const row = PROPOSAL_ROWS[0]!;
    expect(row.proposedToolSignature.length).toBeLessThanOrEqual(1000);
    expect(row.proposedToolSignature.endsWith("… [truncated]")).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// decideOnProposal
// ────────────────────────────────────────────────────────────────────────

describe("decideOnProposal", () => {
  async function seedProposal() {
    const r = await proposeCapability({
      proposingAgentRole: "iris",
      proposedCapabilityName: "thing",
      problemStatement: "p",
      proposedToolSignature: "s",
    });
    return r.proposalId;
  }

  it("accepts a proposal", async () => {
    const id = await seedProposal();
    await decideOnProposal(id, {
      decision: "accepted",
      decidedBy: "solene",
      decisionRationale: "good ROI + low risk",
    });
    const row = PROPOSAL_ROWS.find((r) => r.id === id)!;
    expect(row.status).toBe("accepted");
    expect(row.decidedBy).toBe("solene");
    expect(row.decisionRationale).toBe("good ROI + low risk");
    expect(row.decidedAt).toBeInstanceOf(Date);
  });

  it("defers a proposal", async () => {
    const id = await seedProposal();
    await decideOnProposal(id, {
      decision: "deferred",
      decidedBy: "tom",
      decisionRationale: "wait until Q3",
    });
    expect(PROPOSAL_ROWS[0]!.status).toBe("deferred");
  });

  it("rejects a proposal", async () => {
    const id = await seedProposal();
    await decideOnProposal(id, {
      decision: "rejected",
      decidedBy: "auto-policy",
      decisionRationale: "duplicate of #42",
    });
    expect(PROPOSAL_ROWS[0]!.status).toBe("rejected");
  });

  it("throws when proposal is already decided", async () => {
    const id = await seedProposal();
    await decideOnProposal(id, {
      decision: "accepted",
      decidedBy: "solene",
      decisionRationale: "ok",
    });
    await expect(
      decideOnProposal(id, {
        decision: "rejected",
        decidedBy: "solene",
        decisionRationale: "changed mind",
      }),
    ).rejects.toThrow(/not in 'proposed' state/);
  });

  it("throws on invalid decision value", async () => {
    const id = await seedProposal();
    await expect(
      decideOnProposal(id, {
        // @ts-expect-error testing invalid decision
        decision: "maybe",
        decidedBy: "solene",
        decisionRationale: "x",
      }),
    ).rejects.toThrow(/invalid decision/);
  });

  it("throws on missing proposal", async () => {
    await expect(
      decideOnProposal(999, {
        decision: "accepted",
        decidedBy: "solene",
        decisionRationale: "x",
      }),
    ).rejects.toThrow(/not found/);
  });
});

// ────────────────────────────────────────────────────────────────────────
// markImplemented
// ────────────────────────────────────────────────────────────────────────

describe("markImplemented", () => {
  it("happy path on accepted proposal", async () => {
    const { proposalId } = await proposeCapability({
      proposingAgentRole: "iris",
      proposedCapabilityName: "thing_one",
      problemStatement: "p",
      proposedToolSignature: "s",
    });
    await decideOnProposal(proposalId, {
      decision: "accepted",
      decidedBy: "solene",
      decisionRationale: "ok",
    });
    await markImplemented(proposalId, 1234);
    const row = PROPOSAL_ROWS[0]!;
    expect(row.status).toBe("implemented");
    expect(row.implementingDispatchId).toBe(1234);
  });

  it("throws when proposal is not accepted", async () => {
    const { proposalId } = await proposeCapability({
      proposingAgentRole: "iris",
      proposedCapabilityName: "thing_two",
      problemStatement: "p",
      proposedToolSignature: "s",
    });
    // Still in 'proposed' state.
    await expect(markImplemented(proposalId, 1)).rejects.toThrow(
      /not 'accepted'/,
    );
  });

  it("throws on non-positive dispatch id", async () => {
    await expect(markImplemented(1, 0)).rejects.toThrow(
      /positive integer/,
    );
  });
});

// ────────────────────────────────────────────────────────────────────────
// listProposalsByStatus
// ────────────────────────────────────────────────────────────────────────

describe("listProposalsByStatus", () => {
  it("returns only matching status rows", async () => {
    const a = await proposeCapability({
      proposingAgentRole: "iris",
      proposedCapabilityName: "alpha_tool",
      problemStatement: "p",
      proposedToolSignature: "s",
    });
    const b = await proposeCapability({
      proposingAgentRole: "soren",
      proposedCapabilityName: "beta_tool",
      problemStatement: "p",
      proposedToolSignature: "s",
    });
    await decideOnProposal(b.proposalId, {
      decision: "accepted",
      decidedBy: "solene",
      decisionRationale: "ok",
    });

    const proposed = await listProposalsByStatus("proposed");
    expect(proposed.map((r) => r.id)).toEqual([a.proposalId]);

    const accepted = await listProposalsByStatus("accepted");
    expect(accepted.map((r) => r.id)).toEqual([b.proposalId]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// recordIntrospection + getLatestIntrospection
// ────────────────────────────────────────────────────────────────────────

describe("recordIntrospection + getLatestIntrospection", () => {
  it("records an introspection and returns the latest one for the agent", async () => {
    await recordIntrospection({
      agentRole: "iris",
      availableTools: [{ name: "Bash", description: "run shell" }],
      gapSignals: [
        { pattern: "fly logs grep", occurrences: 8, example: "fly logs | grep" },
      ],
    });
    // Force ordering by simulating elapsed time.
    await new Promise((r) => setTimeout(r, 2));
    const second = await recordIntrospection({
      agentRole: "iris",
      availableTools: [{ name: "Bash", description: "run shell" }],
      gapSignals: [
        { pattern: "x", occurrences: 9, example: "y" },
      ],
    });
    await recordIntrospection({
      agentRole: "soren",
      availableTools: [],
      gapSignals: [],
    });

    const latest = await getLatestIntrospection("iris");
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe(second.introspectionId);
    expect(latest!.agentRole).toBe("iris");
  });

  it("returns null when no introspections exist for the agent", async () => {
    const got = await getLatestIntrospection("beatrice");
    expect(got).toBeNull();
  });

  it("throws on invalid agent role", async () => {
    await expect(
      recordIntrospection({
        // @ts-expect-error invalid role
        agentRole: "ghost",
        availableTools: [],
        gapSignals: [],
      }),
    ).rejects.toThrow(/agentRole/);
  });
});

// ────────────────────────────────────────────────────────────────────────
// rankProposalsByROI
// ────────────────────────────────────────────────────────────────────────

describe("rankProposalsByROI", () => {
  function row(
    id: number,
    value: number | null,
    inv: number | null,
    cost: number | null,
  ): any {
    return {
      id,
      proposedCapabilityName: `tool_${id}`,
      proposedToolSignature: `sig_${id}`,
      expectedValueUsd: value === null ? null : value.toFixed(4),
      expectedInvocationsPerWeek: inv,
      estimatedBuildCostUsd: cost === null ? null : cost.toFixed(4),
    };
  }

  it("ranks 3 proposals high-to-low by ROI", () => {
    // ROI = value * inv * 52 / cost.
    // A: 5 * 10 * 52 / 100   = 26
    // B: 1 * 10 * 52 / 100   = 5.2
    // C: 10 * 20 * 52 / 100  = 104
    const ranked = rankProposalsByROI([
      row(1, 5, 10, 100),
      row(2, 1, 10, 100),
      row(3, 10, 20, 100),
    ]);
    expect(ranked.map((r) => r.proposalId)).toEqual([3, 1, 2]);
    expect(ranked[0]!.roi).toBeCloseTo(104, 5);
    expect(ranked[0]!.breakdown.annualValue).toBeCloseTo(10400, 5);
    expect(ranked[0]!.breakdown.buildCost).toBe(100);
  });

  it("skips rows with any missing or non-positive numeric input", () => {
    const ranked = rankProposalsByROI([
      row(1, 5, 10, 100), // valid
      row(2, null, 10, 100), // missing value
      row(3, 5, null, 100), // missing invocations
      row(4, 5, 10, null), // missing cost
      row(5, 0, 10, 100), // zero value
      row(6, 5, 0, 100), // zero invocations
      row(7, 5, 10, 0), // zero cost
      row(8, -1, 10, 100), // negative value
    ]);
    expect(ranked.map((r) => r.proposalId)).toEqual([1]);
  });

  it("does not crash on empty input", () => {
    expect(rankProposalsByROI([])).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// findDuplicateProposals
// ────────────────────────────────────────────────────────────────────────

describe("findDuplicateProposals", () => {
  function row(id: number, name: string, sig: string): any {
    return {
      id,
      proposedCapabilityName: name,
      proposedToolSignature: sig,
    };
  }

  it("flags pairs with high token overlap; ignores dissimilar pairs", () => {
    const rows = [
      row(
        1,
        "fly_log_search",
        "flyLogSearch(appName: string, requestId: string): Promise<LogLine[]>",
      ),
      row(
        2,
        "fly_log_search",
        "flyLogSearch(appName: string, requestId: string): Promise<LogLine[]>",
      ),
      row(
        3,
        "stripe_invoice_summary",
        "stripeInvoiceSummary(customerId: string): Promise<InvoiceSummary>",
      ),
    ];
    const dupes = findDuplicateProposals(rows);
    // Pair (1,2) is near-identical → flagged. Pair (1,3) and (2,3) are
    // completely different domains → not flagged.
    expect(dupes).toHaveLength(1);
    expect(dupes[0]!.a).toBe(1);
    expect(dupes[0]!.b).toBe(2);
    expect(dupes[0]!.similarity).toBeGreaterThanOrEqual(0.6);
    expect(dupes[0]!.reason).toMatch(/jaccard/);
  });

  it("returns empty when no rows are similar", () => {
    const rows = [
      row(1, "alpha_thing", "alphaThing(x: number): void"),
      row(2, "beta_other", "betaOther(y: string): boolean"),
    ];
    expect(findDuplicateProposals(rows)).toEqual([]);
  });

  it("returns empty for fewer than 2 rows", () => {
    expect(findDuplicateProposals([])).toEqual([]);
    expect(
      findDuplicateProposals([row(1, "solo_tool", "soloTool(): void")]),
    ).toEqual([]);
  });
});
