import { describe, it, expect } from "vitest";
import { climbLadder, type LadderRung } from "../../server/services/autopilot/actionLadder";
import {
  chooseSupportAction,
  chooseFinanceAction,
  chooseGrowthAction,
} from "../../server/services/autopilot/domainLadders";

const earnAll = () => true;
const earnNone = () => false;

describe("actionLadder — the universal discipline (primitive)", () => {
  type Ctx = { a: boolean; b: boolean };
  const ladder: LadderRung<Ctx>[] = [
    { id: "cheap", label: "cheap", rung: 0, cost: "free", reversible: true, requiresEarnedAutonomy: false, available: () => true, justified: (c) => c.a },
    { id: "costly", label: "costly", rung: 1, cost: "costly", reversible: false, requiresEarnedAutonomy: true, available: () => true, justified: (c) => c.b },
  ];

  it("picks the LOWEST justified rung (cheapest-first)", () => {
    expect(climbLadder(ladder, { a: true, b: true }, earnAll).chosen?.id).toBe("cheap");
  });

  it("escalates to the costly rung only when cheap isn't justified — and only when earned", () => {
    expect(climbLadder(ladder, { a: false, b: true }, earnNone).chosen).toBeNull(); // costly not earned
    expect(climbLadder(ladder, { a: false, b: true }, earnAll).chosen?.id).toBe("costly");
  });

  it("holds when nothing is justified", () => {
    const choice = climbLadder(ladder, { a: false, b: false }, earnAll);
    expect(choice.chosen).toBeNull();
    expect(choice.reason).toContain("hold");
  });

  it("emits a glass-box trace per rung", () => {
    const trace = climbLadder(ladder, { a: false, b: true }, earnNone).trace;
    expect(trace.find((t) => t.id === "cheap")?.reason).toContain("not yet justified");
    expect(trace.find((t) => t.id === "costly")?.reason).toContain("not earned");
  });
});

describe("the same discipline across facets — support", () => {
  it("auto-resolves a confident simple ticket (free)", () => {
    expect(chooseSupportAction({ aiConfidence: 0.9, reopened: false, complexity: "low" }, earnAll).chosen?.id).toBe("auto_resolve");
  });
  it("drafts for approval when unsure (cheap, earned) — else escalates", () => {
    expect(chooseSupportAction({ aiConfidence: 0.5, reopened: false, complexity: "low" }, earnAll).chosen?.id).toBe("drafted_reply");
    // not earned → falls through to the founder escalation rung
    expect(chooseSupportAction({ aiConfidence: 0.5, reopened: false, complexity: "low" }, earnNone).chosen?.id).toBe("escalate_founder");
  });
  it("escalates a complex/reopened ticket to the founder", () => {
    expect(chooseSupportAction({ aiConfidence: 0.9, reopened: true, complexity: "high" }, earnAll).chosen?.id).toBe("escalate_founder");
  });
});

describe("the same discipline across facets — finance", () => {
  it("retries first (free, reversible) before any irreversible credit", () => {
    expect(chooseFinanceAction({ paymentFailed: true, retryExhausted: false, retentionCritical: true }, earnAll).chosen?.id).toBe("dunning_retry");
  });
  it("only reaches the irreversible credit once retries are exhausted AND retention is critical AND earned", () => {
    const ctx = { paymentFailed: true, retryExhausted: true, retentionCritical: true };
    expect(chooseFinanceAction(ctx, earnNone).chosen).toBeNull(); // costly+irreversible, not earned
    expect(chooseFinanceAction(ctx, earnAll).chosen?.id).toBe("courtesy_credit");
  });
});

describe("the same discipline across facets — growth (free-first/paid-when-proven)", () => {
  it("runs free owned content first whenever publish is on", () => {
    expect(chooseGrowthAction({ publishEnabled: true, realIntent: true, funnelProven: true, paidProvider: true }, earnAll).chosen?.id).toBe("owned_content");
  });
  it("never reaches paid until the funnel is proven + provider wired + earned", () => {
    // publish off, so owned not available; outbound earned but no real intent; paid not proven
    const unproven = { publishEnabled: false, realIntent: false, funnelProven: false, paidProvider: true };
    expect(chooseGrowthAction(unproven, earnAll).chosen).toBeNull();
    const proven = { publishEnabled: false, realIntent: false, funnelProven: true, paidProvider: true };
    expect(chooseGrowthAction(proven, earnAll).chosen?.id).toBe("paid_ads");
  });
});
