/**
 * The trust seam's verdicts and shadow accounting (stage-4 turn 11).
 *
 * Driven against the real seamVerdict/shadowCompare with the ledger and the
 * never-promote predicate mocked at the module boundary. The properties that
 * matter for the turn-12/13 flips:
 *  1. hard-stop ids are STRUCTURALLY blocked — no ledger level can allow one;
 *  2. unmapped actions escalate (unknown is never allowed);
 *  3. a ledger read failure escalates (a check that cannot run has not passed);
 *  4. levels translate observe→block, draft→escalate, execute_gated→allow;
 *  5. divergences are counted by DIRECTION — seamLooser (legacy refused, seam
 *     would allow) is the widening direction that must stay zero to flip.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  level: "execute_gated" as string,
  ledgerThrows: false,
  neverPromote: new Set<string>(),
}));

vi.mock("../../server/services/autopilot/domainAutonomy", () => ({
  getDomainLevel: vi.fn(async () => {
    if (state.ledgerThrows) throw new Error("ledger down");
    return state.level;
  }),
}));
vi.mock("../../server/services/agentAuthorityGate", () => ({
  isNeverPromote: vi.fn((a: string) => state.neverPromote.has(a)),
}));

import { seamVerdict, shadowCompare, getShadowCounters } from "../../server/services/autopilot/trustSeam";

beforeEach(() => {
  state.level = "execute_gated";
  state.ledgerThrows = false;
  state.neverPromote = new Set();
});

describe("trustSeam verdicts — fail-closed at every edge", () => {
  it("hard-stop ids are structurally blocked regardless of any ledger level", async () => {
    state.neverPromote = new Set(["modify_pricing_plans"]);
    state.level = "autonomous_gated"; // even the highest level cannot help
    const v = await seamVerdict("modify_pricing_plans");
    expect(v.verdict).toBe("block");
    expect(v.domain).toBeNull();
  });

  it("unmapped actions escalate", async () => {
    const v = await seamVerdict("some_action_nobody_registered");
    expect(v.verdict).toBe("escalate");
    expect(v.reason).toMatch(/unmapped/);
  });

  it("a ledger read failure escalates, never allows", async () => {
    state.ledgerThrows = true;
    const v = await seamVerdict("send_follow_up");
    expect(v.verdict).toBe("escalate");
    expect(v.reason).toMatch(/cannot run|failed/i);
  });

  it("levels translate: observe→block, draft→escalate, execute_gated→allow", async () => {
    state.level = "observe";
    expect((await seamVerdict("send_follow_up")).verdict).toBe("block");
    state.level = "draft";
    expect((await seamVerdict("send_follow_up")).verdict).toBe("escalate");
    state.level = "execute_gated";
    expect((await seamVerdict("send_follow_up")).verdict).toBe("allow");
  });
});

describe("shadow accounting — divergence direction is what licenses the flip", () => {
  it("counts agreement, stricter, and LOOSER separately", async () => {
    const before = getShadowCounters();
    // agreement: both allow
    state.level = "execute_gated";
    await shadowCompare({ gate: "executionEngine", agentCodename: "t", action: "send_follow_up", legacyAllowed: true });
    // seam stricter: legacy allowed, seam blocks
    state.level = "observe";
    await shadowCompare({ gate: "executionEngine", agentCodename: "t", action: "send_follow_up", legacyAllowed: true });
    // seam LOOSER: legacy refused, seam allows — the dangerous direction
    state.level = "execute_gated";
    await shadowCompare({ gate: "agentAuthorityGate", agentCodename: "t", action: "send_follow_up", legacyAllowed: false });
    const after = getShadowCounters();
    expect(after.comparisons - before.comparisons).toBe(3);
    expect(after.agreements - before.agreements).toBe(1);
    expect(after.seamStricter - before.seamStricter).toBe(1);
    expect(after.seamLooser - before.seamLooser).toBe(1);
    expect(after.byAction["send_follow_up"].divergences).toBeGreaterThanOrEqual(2);
  });

  it("never throws even when the seam itself fails", async () => {
    state.ledgerThrows = true;
    await expect(
      shadowCompare({ gate: "executionEngine", agentCodename: "t", action: "send_follow_up", legacyAllowed: true }),
    ).resolves.toBeUndefined();
  });
});
