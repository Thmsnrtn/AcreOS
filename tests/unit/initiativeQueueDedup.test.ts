import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ transaction: vi.fn(), execute: vi.fn(), select: vi.fn(), from: vi.fn(), where: vi.fn(), limit: vi.fn(), insert: vi.fn(), values: vi.fn() }));
vi.mock("../../server/db", () => ({ db: { transaction: h.transaction } }));
vi.mock("../../server/websocket", () => ({ wsServer: { broadcastFounderEvent: vi.fn() } }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
import { agentInitiativeEngine } from "../../server/services/agentInitiativeEngine";
const proposal = { agentCodename: "sophie", type: "opportunity" as const, title: "Review lead", description: "Review recorded contact history.", action: "send_follow_up", actionInput: { leadId: 7, channel: "email" }, confidence: 0.85, reasoning: "Unknown suitability", estimatedImpact: "Unknown" };
beforeEach(() => {
  vi.resetAllMocks();
  h.transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn({ execute: h.execute, select: h.select, insert: h.insert }));
  h.select.mockReturnValue({ from: h.from }); h.from.mockReturnValue({ where: h.where }); h.where.mockReturnValue({ limit: h.limit }); h.limit.mockResolvedValue([]);
  h.insert.mockReturnValue({ values: h.values }); h.values.mockResolvedValue(undefined);
});
describe("initiative transaction refusal and event boundary", () => {
  it("persists the card and event together after acquiring the lock", async () => {
    expect(await agentInitiativeEngine.enqueueProposal(1, proposal, 20)).toBe(true);
    expect(h.execute.mock.invocationCallOrder[0]).toBeLessThan(h.select.mock.invocationCallOrder[0]);
    expect(h.values).toHaveBeenCalledTimes(2);
    expect(h.values.mock.calls[0][0]).toMatchObject({ organizationId: 1, status: "pending", recommendedAction: "send_follow_up" });
    expect(h.values.mock.calls[1][0]).toMatchObject({ organizationId: 1, eventType: "initiative_proposal" });
  });
  it("an existing active card emits no duplicate card or event", async () => {
    h.limit.mockResolvedValue([{ id: 8 }]);
    expect(await agentInitiativeEngine.enqueueProposal(1, proposal, 20)).toBe(false); expect(h.insert).not.toHaveBeenCalled();
  });
  it("does not claim an escalation succeeded when the card write failed", async () => {
    h.values.mockRejectedValueOnce(new Error("write unavailable"));
    await expect(agentInitiativeEngine.enqueueProposal(1, proposal, 20)).rejects.toThrow("write unavailable");
    expect(h.values).toHaveBeenCalledTimes(1);
  });
});
