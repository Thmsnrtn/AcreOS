import { describe, it, expect, vi, beforeEach } from "vitest";
import { actionContentHash } from "../../server/services/approvalKernel";

// Controllable db: queues feed each terminal in approve/reject.
const { state, witnessMock } = vi.hoisted(() => ({
  state: { sel: [] as any[], upRet: [] as any[], inserted: [] as any[] },
  witnessMock: vi.fn(),
}));

vi.mock("../../server/db", () => {
  const selChain: any = { from: () => selChain, where: () => selChain, orderBy: () => selChain, limit: () => selChain, then: (f: any, r: any) => Promise.resolve(state.sel.shift() ?? []).then(f, r) };
  const upChain: any = { set: () => upChain, where: () => upChain, returning: () => Promise.resolve(state.upRet.shift() ?? []), then: (f: any, r: any) => Promise.resolve([]).then(f, r) };
  const insChain: any = { values: (v: any) => { state.inserted.push(v); return Promise.resolve(undefined); }, returning: () => Promise.resolve([]) };
  return { db: { select: () => selChain, update: () => upChain, insert: () => insChain } };
});
vi.mock("../../server/services/autopilot/hands", () => ({ executeHandWitnessed: witnessMock }));

import { approvePendingHand, rejectPendingHand } from "../../server/services/autopilot/pendingHands";

const HAND = "send_email";
const ARGS = { to: "a@b.com", subject: "Hi", html: "<p>x</p>" };
const GOOD_HASH = actionContentHash(HAND, ARGS);

function freshAction(over: Partial<any> = {}) {
  return { id: 1, handName: HAND, args: ARGS, contentHash: GOOD_HASH, domain: "support", status: "pending", expiresAt: new Date(Date.now() + 60_000), sourceDispatchId: null, resultSummary: null, ...over };
}

beforeEach(() => {
  state.sel = [];
  state.upRet = [];
  state.inserted = [];
  vi.clearAllMocks();
});

describe("pendingHands — approve (the witnessed executor)", () => {
  it("re-verifies the content hash and REFUSES tampered args (no execution)", async () => {
    state.sel = [[freshAction({ contentHash: "TAMPERED" })]];
    const out = await approvePendingHand({ id: 1, approvedBy: "founder_1" });
    expect(out.outcome).toBe("hash_mismatch");
    expect(witnessMock).not.toHaveBeenCalled();
  });

  it("executes exactly the frozen row on a clean approval + writes the append-only audit", async () => {
    state.sel = [[freshAction()]];
    state.upRet = [[{ id: 1 }]]; // the atomic pending→approved claim wins
    witnessMock.mockResolvedValue({ success: true, output: JSON.stringify({ messageId: "m1" }), durationMs: 1 });
    const out = await approvePendingHand({ id: 1, approvedBy: "founder_1" });
    expect(out.outcome).toBe("executed");
    expect(witnessMock).toHaveBeenCalledWith(HAND, ARGS, "founder_1", expect.anything());
    // audit row inserted
    expect(state.inserted.some((v) => v.handName === HAND && v.approvedBy === "founder_1")).toBe(true);
  });

  it("does not double-execute: a lost claim race on an executed row returns already_executed", async () => {
    state.sel = [[freshAction()], [freshAction({ status: "executed", resultSummary: { success: true } })]];
    state.upRet = [[]]; // claim returns empty → lost the race
    const out = await approvePendingHand({ id: 1, approvedBy: "founder_1" });
    expect(out.outcome).toBe("already_executed");
    expect(witnessMock).not.toHaveBeenCalled();
  });

  it("refuses an expired action", async () => {
    state.sel = [[freshAction({ expiresAt: new Date(Date.now() - 1000) })]];
    const out = await approvePendingHand({ id: 1, approvedBy: "founder_1" });
    expect(out.outcome).toBe("expired");
    expect(witnessMock).not.toHaveBeenCalled();
  });

  it("releases the claim (nothing sent) when execution fails", async () => {
    state.sel = [[freshAction()]];
    state.upRet = [[{ id: 1 }]];
    witnessMock.mockResolvedValue({ success: false, output: "send failed", durationMs: 1 });
    const out = await approvePendingHand({ id: 1, approvedBy: "founder_1" });
    expect(out.outcome).toBe("execution_failed");
    expect(state.inserted.length).toBe(0); // no audit on a failed send
  });
});

describe("pendingHands — reject (terminal)", () => {
  it("rejects a pending action", async () => {
    state.upRet = [[{ id: 1 }]];
    const out = await rejectPendingHand(1);
    expect(out.outcome).toBe("rejected");
  });

  it("reports not_found when nothing matched and no row exists", async () => {
    state.upRet = [[]];
    state.sel = [[]];
    const out = await rejectPendingHand(1);
    expect(out.outcome).toBe("not_found");
  });
});
