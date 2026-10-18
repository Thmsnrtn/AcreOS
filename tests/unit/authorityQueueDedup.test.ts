import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  transaction: vi.fn(), execute: vi.fn(), select: vi.fn(), from: vi.fn(), where: vi.fn(), limit: vi.fn(),
  insert: vi.fn(), values: vi.fn(), returning: vi.fn(), agent: { trustScore: 20 },
}));
vi.mock("../../server/db", () => ({ db: {
  transaction: h.transaction, insert: h.insert,
  query: { companyAgents: { findFirst: async () => ({ status: "active", trustScore: h.agent.trustScore,
    authorityConfig: { level0Actions: [], level1Actions: [], level2Actions: [], level3Actions: [] } }) } },
} }));
vi.mock("../../server/services/temporaryDelegation", () => ({ checkTemporaryDelegation: async () => ({ hasDelegation: false }) }));
import { executeWithAuthority } from "../../server/services/agentAuthorityGate";

beforeEach(() => {
  vi.clearAllMocks(); h.agent.trustScore = 20;
  h.transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn({ execute: h.execute, select: h.select, insert: h.insert }));
  h.select.mockReturnValue({ from: h.from }); h.from.mockReturnValue({ where: h.where }); h.where.mockReturnValue({ limit: h.limit }); h.limit.mockResolvedValue([]);
  h.insert.mockReturnValue({ values: h.values }); h.values.mockReturnValue({ returning: h.returning }); h.returning.mockResolvedValue([{ id: 1 }]);
});

describe("repeated authority observations remain questions, not grants", () => {
  it.each([20, 60])("creates a subject-bearing question at trust %i without executing", async (trustScore) => {
    h.agent.trustScore = trustScore;
    const executor = vi.fn();
    const result = await executeWithAuthority("sentinel_devops", "proactive:jobs", executor, { actionType: "proactive", input: { failures: [{ jobName: "retract", count: 48 }] } });
    expect(result).toMatchObject({ success: false, escalated: true, logId: 1 });
    expect(executor).not.toHaveBeenCalled();
    expect(h.execute.mock.invocationCallOrder[0]).toBeLessThan(h.select.mock.invocationCallOrder[0]);
    expect(h.values.mock.calls[1][0]).toMatchObject({ status: "pending", contextBundle: { authorityQuestion: { action: "proactive:jobs", input: { failures: [{ jobName: "retract", count: 48 }] }, relatedGoalId: null } } });
  });
  it("retains an active/deferred question while keeping the attempt audit log", async () => {
    h.limit.mockResolvedValue([{ id: 19 }]);
    const executor = vi.fn();
    expect(await executeWithAuthority("sentinel_devops", "proactive:jobs", executor, { actionType: "proactive", input: { failures: [] } })).toMatchObject({ success: false, escalated: true });
    expect(h.values).toHaveBeenCalledTimes(1); // attempt log only
    expect(executor).not.toHaveBeenCalled();
  });
  it("does not fold tenant skills when their trusted organization is absent", async () => {
    await executeWithAuthority("sentinel_devops", "send_followup", vi.fn(), { actionType: "skill", input: { leadId: 7 } });
    expect(h.transaction).not.toHaveBeenCalled(); expect(h.values).toHaveBeenCalledTimes(2);
  });
  it("does not report an escalation when queue persistence fails", async () => {
    h.transaction.mockRejectedValue(new Error("queue unavailable"));
    await expect(executeWithAuthority("sentinel_devops", "proactive:jobs", vi.fn(), { actionType: "proactive", input: {} })).rejects.toThrow("queue unavailable");
  });
});
