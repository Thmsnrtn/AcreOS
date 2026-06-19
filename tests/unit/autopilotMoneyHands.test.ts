import { describe, it, expect, vi, beforeEach } from "vitest";

const { dunningMock, refundsCreate } = vi.hoisted(() => ({
  dunningMock: { retryPayment: vi.fn(), cancelCase: vi.fn(), resolveCase: vi.fn() },
  refundsCreate: vi.fn(),
}));
vi.mock("../../server/services/dunning", () => ({ dunningService: dunningMock }));
vi.mock("../../server/stripeClient", () => ({
  getUncachableStripeClient: vi.fn().mockResolvedValue({ refunds: { create: refundsCreate } }),
}));

import { getHand, executeHandWitnessed } from "../../server/services/autopilot/hands";
import { executeDispatchTool } from "../../server/services/solene/dispatchToolExecutor";
import { REFUND_CEILING_CENTS } from "../../server/services/autopilot/hands/apply-refund";

describe("money limb — dunning_action (reversible, autonomy-gated)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is finance domain + WITNESSED (money never moves without a tap — elite-audit P0)", () => {
    const h = getHand("dunning_action");
    expect(h?.domain).toBe("finance");
    expect(h?.requiresApproval).toBe(true);
  });

  it("the executor refuses a direct model call (no autonomous money)", async () => {
    const r = await executeDispatchTool("dunning_action", { event_id: 42, action: "retry" });
    expect(r.success).toBe(false);
    expect(r.output).toContain("WITNESSED-SEND");
    expect(dunningMock.retryPayment).not.toHaveBeenCalled();
  });

  it("retries a failed invoice via the witnessed path", async () => {
    dunningMock.retryPayment.mockResolvedValue({ success: true, message: "retry scheduled" });
    const r = await executeHandWitnessed("dunning_action", { event_id: 42, action: "retry" }, "founder_1");
    expect(r.success).toBe(true);
    expect(dunningMock.retryPayment).toHaveBeenCalledWith(42);
  });

  it("rejects an unknown action (handler validation, via the witnessed path)", async () => {
    const r = await executeHandWitnessed("dunning_action", { event_id: 1, action: "delete" }, "founder_1");
    expect(r.success).toBe(false);
    expect(dunningMock.retryPayment).not.toHaveBeenCalled();
  });
});

describe("money limb — apply_refund (irreversible, approval-required, $50 cap)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is approval-required + customer-facing", () => {
    const h = getHand("apply_refund");
    expect(h?.requiresApproval).toBe(true);
    expect(h?.isCustomerFacing).toBe(true);
  });

  it("the executor refuses a direct model call (witnessed-send wall)", async () => {
    const r = await executeDispatchTool("apply_refund", { charge_id: "ch_1", amount_cents: 1000 });
    expect(r.success).toBe(false);
    expect(r.output).toContain("WITNESSED-SEND");
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("refuses an amount over the $50 ceiling even when witnessed", async () => {
    const r = await executeHandWitnessed("apply_refund", { charge_id: "ch_1", amount_cents: REFUND_CEILING_CENTS + 1 }, "founder_1");
    expect(r.success).toBe(false);
    expect(r.output).toContain("ceiling");
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("issues a within-ceiling refund via the witnessed path", async () => {
    refundsCreate.mockResolvedValue({ id: "re_1" });
    const r = await executeHandWitnessed("apply_refund", { charge_id: "ch_1", amount_cents: 2500 }, "founder_1");
    expect(r.success).toBe(true);
    expect(refundsCreate).toHaveBeenCalledWith({ charge: "ch_1", amount: 2500 });
  });
});
