import { describe, it, expect } from "vitest";
import {
  classifyEscalation,
  STRUCTURAL_BLOCK_THRESHOLD,
  type EscalationContext,
} from "../../server/services/autopilot/escalation";
import type { PolicyGateDecision } from "../../server/services/autopilot/policyGate";

const ctx = (over: Partial<EscalationContext> = {}): EscalationContext => ({
  domain: "growth",
  isCustomerFacing: false,
  recentBlockCount: 0,
  envelopeStatus: "green",
  ...over,
});

const decision = (
  d: PolicyGateDecision["decision"],
  decidedBy?: PolicyGateDecision["decidedBy"],
): PolicyGateDecision => ({ decision: d, results: [], decidedBy });

describe("autopilot escalation classifier — the founder's attention budget", () => {
  it("a clean pass is NEVER surfaced (the 0.01% promise)", () => {
    const v = classifyEscalation(decision("pass"), ctx());
    expect(v.escalate).toBe(false);
    expect(v.action).toBe("none");
  });

  it("witnessed-send always reaches the founder as a decision", () => {
    const v = classifyEscalation(decision("escalate", "witnessed_send"), ctx({ isCustomerFacing: true }));
    expect(v.escalate).toBe(true);
    expect(v.action).toBe("founder_ask");
    expect(v.urgency).toBe("normal");
  });

  it("money movement (finance) is raised urgently; other sends stay normal", () => {
    expect(classifyEscalation(decision("escalate", "witnessed_send"), ctx({ domain: "finance" })).urgency).toBe("urgent");
    expect(classifyEscalation(decision("escalate", "witnessed_send"), ctx({ domain: "support" })).urgency).toBe("normal");
  });

  it("a one-off compliance block is self-correction — silent by design", () => {
    const v = classifyEscalation(decision("block", "compliance"), ctx({ recentBlockCount: 1 }));
    expect(v.escalate).toBe(false);
    expect(v.action).toBe("none");
  });

  it("a STRUCTURAL compliance block (repeated) is surfaced urgently — the system is stuck", () => {
    const v = classifyEscalation(
      decision("block", "compliance"),
      ctx({ recentBlockCount: STRUCTURAL_BLOCK_THRESHOLD }),
    );
    expect(v.escalate).toBe(true);
    expect(v.urgency).toBe("urgent");
    expect(v.reason).toMatch(/stuck/i);
  });

  it("an autonomy block becomes a DRAFT for review — never a silent drop (this is how trust is earned)", () => {
    const v = classifyEscalation(decision("block", "autonomy"), ctx({ isCustomerFacing: false }));
    expect(v.escalate).toBe(true);
    expect(v.action).toBe("founder_draft_review");
    expect(v.urgency).toBe("low");
    // customer-facing drafts are slightly more pressing
    expect(classifyEscalation(decision("block", "autonomy"), ctx({ isCustomerFacing: true })).urgency).toBe("normal");
  });

  it("a transient budget cap is silent; a budget block under a RED envelope reaches the founder", () => {
    expect(classifyEscalation(decision("block", "budget"), ctx({ envelopeStatus: "green" })).escalate).toBe(false);
    const red = classifyEscalation(decision("block", "budget"), ctx({ envelopeStatus: "red" }));
    expect(red.escalate).toBe(true);
    expect(red.urgency).toBe("normal");
    expect(red.reason).toMatch(/runway/i);
  });

  it("a one-off quality block is silent (regenerate); repeated failure to produce output is surfaced", () => {
    expect(classifyEscalation(decision("block", "quality"), ctx({ recentBlockCount: 1 })).escalate).toBe(false);
    const stuck = classifyEscalation(decision("block", "quality"), ctx({ recentBlockCount: STRUCTURAL_BLOCK_THRESHOLD }));
    expect(stuck.escalate).toBe(true);
    expect(stuck.action).toBe("founder_ask");
  });

  it("an unrecognized terminal cause fails safe toward visibility, never silence", () => {
    const v = classifyEscalation(decision("block", undefined), ctx());
    expect(v.escalate).toBe(true);
    expect(v.action).toBe("founder_ask");
  });
});
