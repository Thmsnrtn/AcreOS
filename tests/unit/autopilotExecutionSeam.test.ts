import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Part 1: the executor FREEZES an approval-required hand into the seam ──────
const { proposeMock } = vi.hoisted(() => ({ proposeMock: vi.fn() }));
vi.mock("../../server/services/autopilot/pendingHands", () => ({
  proposePendingHand: proposeMock,
}));

import { executeDispatchTool } from "../../server/services/solene/dispatchToolExecutor";

describe("execution seam — executor freezes approval-required hands (H1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("freezes send_email for founder approval instead of sending or dead-ending", async () => {
    proposeMock.mockResolvedValue({ id: 77 });
    const r = await executeDispatchTool("send_email", { to: "a@b.com", subject: "Hi", html: "<p>x</p>" }, { dispatchId: 5 });
    expect(r.success).toBe(false);
    expect(r.output).toContain("FROZEN");
    expect(r.output).toContain("#77");
    // It captured the drafted args + the source dispatch, bound to the hand.
    expect(proposeMock).toHaveBeenCalledOnce();
    const arg = proposeMock.mock.calls[0][0];
    expect(arg.handName).toBe("send_email");
    expect(arg.args.subject).toBe("Hi");
    expect(arg.domain).toBe("support");
    expect(arg.sourceDispatchId).toBe(5);
    expect(arg.summary).toContain("a@b.com");
  });

  it("falls back to a plain refusal (never a send) if freezing fails", async () => {
    proposeMock.mockResolvedValue(null);
    const r = await executeDispatchTool("send_email", { to: "a@b.com", subject: "Hi", html: "<p>x</p>" }, { dispatchId: 5 });
    expect(r.success).toBe(false);
    expect(r.output).toContain("Refusing");
  });
});
