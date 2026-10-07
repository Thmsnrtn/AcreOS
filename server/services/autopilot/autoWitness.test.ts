/**
 * Tests for the auto-witness sweep (step-away gap #5).
 *
 * The pure policy engine (witnessGrant.ts) has its own exhaustive contract;
 * these tests cover the INTEGRATION: fail-closed sweep behavior, provable-cost
 * discipline for money hands, atomic budget consumption ordering, in-sweep
 * budget honesty, and the attribution string that keeps accountability intact.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── settings: panic stop toggle ──────────────────────────────────────────────
let panicStopped = false;
vi.mock("./settings", () => ({
  isPanicStopped: () => panicStopped,
}));

// ── grant store: policy-shaped grants pass straight through ─────────────────
import type { WitnessGrant } from "./witnessGrant";
let grants: WitnessGrant[] = [];
const consumeGrantUseMock = vi.fn(async (_id: number) => true);
vi.mock("./witnessGrantStore", () => ({
  liveGrantsFor: vi.fn(async () => grants),
  toPolicyGrant: (g: unknown) => g,
  consumeGrantUse: (id: number) => consumeGrantUseMock(id),
}));

// ── delegated-release rules (controls + hand rules), default: nothing blocks ──
let controlsBlock: string | null = null;
let handRefusal: string | null = null;
const handRefusalMock = vi.fn(async (_h: string, _a: Record<string, unknown>) => handRefusal);
vi.mock("./delegationRules", () => ({
  delegationBlockedByControls: vi.fn(async () => controlsBlock),
  delegatedHandRefusal: (h: string, a: Record<string, unknown>) => handRefusalMock(h, a),
}));

// ── pending hands + hand registry ────────────────────────────────────────────
interface FakePending {
  id: number;
  handName: string;
  args: Record<string, unknown>;
  /** Who drafted it; send_email defaults to the Retention worker. */
  sourceRole?: string | null;
}
let pending: FakePending[] = [];
const approveMock = vi.fn(async (_input: { id: number; approvedBy: string; now?: number }) => ({
  outcome: "executed" as const,
  result: { success: true },
}));
vi.mock("./pendingHands", () => ({
  listPendingHands: vi.fn(async () => pending.map((p) => ({ sourceRole: p.handName === "send_email" ? "retention" : null, ...p }))),
  approvePendingHand: (input: any) => approveMock(input),
}));

const HAND_SPECS: Record<string, { domain: string; movesMoney?: boolean; outwardClass?: string }> = {
  send_email: { domain: "support" },
  apply_refund: { domain: "finance", movesMoney: true },
  publish_post: { domain: "growth", outwardClass: "broadcast" },
};
vi.mock("./hands", () => ({
  getHand: (name: string) => HAND_SPECS[name],
}));

import { runAutoWitnessSweep, predictedCostUsdFromArgs, AUTO_WITNESS_GRANTEE } from "./autoWitness";

const NOW = Date.parse("2026-07-03T12:00:00Z");

// `Partial<WitnessGrant>` makes `bounds` OPTIONAL but leaves its inner fields
// required, so intersecting it with `{ bounds?: Partial<...> }` resolves to
// `WitnessGrantBounds & Partial<WitnessGrantBounds>` — the full type. Every
// call site here passes a subset, which is the helper's entire purpose. Omit
// the key before intersecting so the partial actually applies.
function makeGrant(
  over: Omit<Partial<WitnessGrant>, "bounds"> & { bounds?: Partial<WitnessGrant["bounds"]> } = {},
): WitnessGrant {
  return {
    id: over.id ?? "1",
    grantorId: over.grantorId ?? "founder-tom",
    granteeId: over.granteeId ?? AUTO_WITNESS_GRANTEE,
    bounds: {
      domains: ["support"],
      hands: ["send_email"],
      sourceRoles: ["retention"],
      maxCostUsd: 10,
      maxActions: 5,
      expiresAt: new Date(NOW + 24 * 60 * 60 * 1000).toISOString(),
      denyMoney: true,
      denyBroadcast: true,
      ...(over.bounds ?? {}),
    },
    usedCount: over.usedCount ?? 0,
    revoked: over.revoked ?? false,
    issuedAt: new Date(NOW - 60_000).toISOString(),
  };
}

beforeEach(() => {
  panicStopped = false;
  controlsBlock = null;
  handRefusal = null;
  grants = [];
  pending = [];
  vi.clearAllMocks();
  consumeGrantUseMock.mockResolvedValue(true);
  approveMock.mockResolvedValue({ outcome: "executed" as const, result: { success: true } });
});

describe("predictedCostUsdFromArgs", () => {
  it("reads explicit USD amounts", () => {
    expect(predictedCostUsdFromArgs({ amount_usd: 12.5 })).toBe(12.5);
    expect(predictedCostUsdFromArgs({ refund_amount_usd: 3 })).toBe(3);
  });
  it("converts cent amounts", () => {
    expect(predictedCostUsdFromArgs({ amount_cents: 250 })).toBe(2.5);
  });
  it("returns null when no amount is provable", () => {
    expect(predictedCostUsdFromArgs({ to: "x@y.com", body: "hi" })).toBeNull();
    expect(predictedCostUsdFromArgs({ amount_usd: Number.NaN })).toBeNull();
  });
});

describe("runAutoWitnessSweep — fail-closed floors", () => {
  it("does nothing while the panic stop is engaged", async () => {
    panicStopped = true;
    grants = [makeGrant()];
    pending = [{ id: 1, handName: "send_email", args: {} }];
    const r = await runAutoWitnessSweep({ now: NOW });
    expect(r.considered).toBe(0);
    expect(approveMock).not.toHaveBeenCalled();
  });

  it("with zero grants issued the sweep is a pure no-op (status quo)", async () => {
    pending = [{ id: 1, handName: "send_email", args: {} }];
    const r = await runAutoWitnessSweep({ now: NOW });
    expect(r.considered).toBe(0);
    expect(r.witnessed).toBe(0);
    expect(approveMock).not.toHaveBeenCalled();
  });
});

describe("runAutoWitnessSweep — delegation", () => {
  it("witnesses a covered support action with full attribution", async () => {
    grants = [makeGrant()];
    pending = [{ id: 7, handName: "send_email", args: { to: "seller@x.com" } }];
    const r = await runAutoWitnessSweep({ now: NOW });
    expect(r.witnessed).toBe(1);
    expect(consumeGrantUseMock).toHaveBeenCalledWith(1);
    const approver = approveMock.mock.calls[0][0].approvedBy as string;
    expect(approver).toContain(AUTO_WITNESS_GRANTEE);
    expect(approver).toContain("delegated by founder-tom");
    expect(approver).toContain("witness-grant #1");
  });

  it("consumes the budget slot BEFORE tapping; a lost race skips the tap", async () => {
    grants = [makeGrant()];
    pending = [{ id: 7, handName: "send_email", args: {} }];
    consumeGrantUseMock.mockResolvedValueOnce(false); // revoked/exhausted since load
    const r = await runAutoWitnessSweep({ now: NOW });
    expect(r.witnessed).toBe(0);
    expect(approveMock).not.toHaveBeenCalled();
    expect(r.decisions[0].reason).toContain("unavailable");
  });

  it("never covers a money hand whose amount cannot be proven from frozen args", async () => {
    grants = [makeGrant({ bounds: { domains: ["finance"], hands: ["apply_refund"], sourceRoles: ["support"], denyMoney: false } })];
    pending = [{ id: 3, handName: "apply_refund", args: { invoice: "in_123" }, sourceRole: "support" }];
    const r = await runAutoWitnessSweep({ now: NOW });
    expect(r.witnessed).toBe(0);
    expect(r.decisions[0].reason).toContain("no provable amount");
    expect(consumeGrantUseMock).not.toHaveBeenCalled();
  });

  it("covers a money hand ONLY with explicit opt-in and a provable amount under the ceiling", async () => {
    grants = [makeGrant({ bounds: { domains: ["finance"], hands: ["apply_refund"], sourceRoles: ["support"], denyMoney: false, maxCostUsd: 50 } })];
    pending = [{ id: 3, handName: "apply_refund", args: { refund_amount_usd: 20 }, sourceRole: "support" }];
    const r = await runAutoWitnessSweep({ now: NOW });
    expect(r.witnessed).toBe(1);
  });

  it("denies a money hand when the grant keeps the deny-money belt on", async () => {
    grants = [makeGrant({ bounds: { domains: ["finance"], hands: ["apply_refund"], sourceRoles: ["support"] } })]; // denyMoney defaults true
    pending = [{ id: 3, handName: "apply_refund", args: { refund_amount_usd: 5 }, sourceRole: "support" }];
    const r = await runAutoWitnessSweep({ now: NOW });
    expect(r.witnessed).toBe(0);
    expect(r.decisions[0].reason).toContain("money");
  });

  it("denies an over-ceiling amount", async () => {
    grants = [makeGrant({ bounds: { domains: ["finance"], hands: ["apply_refund"], sourceRoles: ["support"], denyMoney: false, maxCostUsd: 10 } })];
    pending = [{ id: 3, handName: "apply_refund", args: { refund_amount_usd: 11 }, sourceRole: "support" }];
    const r = await runAutoWitnessSweep({ now: NOW });
    expect(r.witnessed).toBe(0);
    expect(r.decisions[0].reason).toContain("ceiling");
  });

  it("respects the action budget WITHIN one sweep", async () => {
    grants = [makeGrant({ bounds: { maxActions: 1 } })];
    pending = [
      { id: 1, handName: "send_email", args: {} },
      { id: 2, handName: "send_email", args: {} },
    ];
    const r = await runAutoWitnessSweep({ now: NOW });
    expect(r.witnessed).toBe(1);
    expect(r.decisions[1].outcome).toBe("skipped");
    expect(r.decisions[1].reason).toContain("budget exhausted");
  });

  it("a broadcast hand is never grant-released — not even with the broadcast opt-in", async () => {
    grants = [makeGrant({ bounds: { domains: ["growth"], hands: ["publish_post"], sourceRoles: ["writer"], denyBroadcast: false } })];
    pending = [{ id: 9, handName: "publish_post", args: {}, sourceRole: "writer" }];
    const r = await runAutoWitnessSweep({ now: NOW });
    expect(r.witnessed).toBe(0);
    expect(r.decisions[0].reason).toContain("never grant-released");
  });

  it("keeps the budget spent when the approval path refuses (conservative)", async () => {
    grants = [makeGrant()];
    pending = [{ id: 7, handName: "send_email", args: {} }];
    approveMock.mockResolvedValueOnce({ outcome: "expired" } as any);
    const r = await runAutoWitnessSweep({ now: NOW });
    expect(r.witnessed).toBe(0);
    expect(consumeGrantUseMock).toHaveBeenCalledTimes(1);
    expect(r.decisions[0].reason).toContain("approval path refused");
  });

  it("skips a hand not registered in this process", async () => {
    grants = [makeGrant()];
    pending = [{ id: 4, handName: "mystery_hand", args: {} }];
    const r = await runAutoWitnessSweep({ now: NOW });
    expect(r.witnessed).toBe(0);
    expect(r.decisions[0].reason).toContain("not registered");
  });
});

// ── H1 / H2: the grant knows the hand, who drafted it, and the founder's controls ──
describe("runAutoWitnessSweep — hand, role and control bounds", () => {
  const financeGrant = () =>
    makeGrant({ bounds: { domains: ["finance"], hands: ["apply_refund"], sourceRoles: ["support"], denyMoney: false, maxCostUsd: 50 } });

  it("a coding-agent-frozen apply_refund (no source role) with a live finance grant is NOT released and NOT executed", async () => {
    grants = [financeGrant()];
    pending = [{ id: 11, handName: "apply_refund", args: { charge_id: "pi_other_org", amount_cents: 4000, organization_id: 999 }, sourceRole: null }];
    const r = await runAutoWitnessSweep({ now: NOW });
    expect(r.witnessed).toBe(0);
    expect(approveMock).not.toHaveBeenCalled();
    expect(consumeGrantUseMock).not.toHaveBeenCalled();
    expect(r.decisions[0].reason).toMatch(/no source role/);
  });

  it("a Support-drafted refund of a foreign or already-refunded charge is NOT released and NOT executed", async () => {
    grants = [financeGrant()];
    handRefusal = "apply_refund: pi_dup has already been refunded (or a refund of it is in flight) — never twice. Refusing.";
    pending = [{ id: 12, handName: "apply_refund", args: { charge_id: "pi_dup", amount_cents: 3000, organization_id: 5 }, sourceRole: "support" }];
    const r = await runAutoWitnessSweep({ now: NOW });
    expect(r.witnessed).toBe(0);
    expect(approveMock).not.toHaveBeenCalled();
    expect(consumeGrantUseMock).not.toHaveBeenCalled();
    expect(handRefusalMock).toHaveBeenCalledWith("apply_refund", expect.objectContaining({ charge_id: "pi_dup" }));
    expect(r.decisions[0].reason).toMatch(/never twice/);
  });

  it("a send_email drafted by a role the grant does not name is not released", async () => {
    grants = [makeGrant()]; // retention only
    pending = [{ id: 13, handName: "send_email", args: { to: "a@b.c" }, sourceRole: "outbound_seam" }];
    const r = await runAutoWitnessSweep({ now: NOW });
    expect(r.witnessed).toBe(0);
    expect(r.decisions[0].reason).toMatch(/source role "outbound_seam" not in grant/);
  });

  it("a hand the grant does not name is not released, even in a covered domain", async () => {
    HAND_SPECS.send_sms = { domain: "support" };
    grants = [makeGrant()];
    pending = [{ id: 14, handName: "send_sms", args: {}, sourceRole: "retention" }];
    const r = await runAutoWitnessSweep({ now: NOW });
    expect(r.witnessed).toBe(0);
    expect(r.decisions[0].reason).toMatch(/hand "send_sms" not in grant/);
    delete HAND_SPECS.send_sms;
  });

  it("a paused / quarantined domain or dispatch-off releases nothing, and spends no slot", async () => {
    grants = [makeGrant()];
    pending = [{ id: 15, handName: "send_email", args: { to: "owner@x.com" } }];
    controlsBlock = "the founder paused support";
    const r = await runAutoWitnessSweep({ now: NOW });
    expect(r.witnessed).toBe(0);
    expect(approveMock).not.toHaveBeenCalled();
    expect(consumeGrantUseMock).not.toHaveBeenCalled();
    expect(r.decisions[0].reason).toMatch(/paused support/);
  });

  it("a released action carries the grant into the approval path (the executor re-checks)", async () => {
    grants = [makeGrant()];
    pending = [{ id: 16, handName: "send_email", args: { to: "owner@x.com" } }];
    await runAutoWitnessSweep({ now: NOW });
    expect(approveMock.mock.calls[0][0]).toMatchObject({ id: 16, delegation: { grantId: "1" } });
  });
});
