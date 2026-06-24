import { describe, it, expect, vi } from "vitest";
import { runPolicyGateStack, type PolicyAction, type PolicyGateDeps } from "../../server/services/autopilot/policyGate";
import { orgScope } from "../../server/services/autopilot/tenantScope";

// kernel-elevation T0.2 — the gate stack must FAIL CLOSED under any gate-
// dependency outage: a throw, a rejection, a hang, or a malformed response must
// terminate to a non-pass verdict, never silently bypass the safety floor.

const action: PolicyAction = {
  domain: "growth",
  actionKind: "run_ads",
  scope: orgScope(1),
  isCustomerFacing: false,
  toolCall: { dispatchId: 1, toolName: "send_email", toolInput: {}, agentRole: "soren" },
  output: { surface: "content", modelKey: "x", text: "hello" },
};

function deps(over: Partial<PolicyGateDeps> = {}): Partial<PolicyGateDeps> {
  return {
    screenToolCall: vi.fn().mockResolvedValue({ allowed: true, immutableNumber: null, immutableText: null, reason: "" }),
    gateOutputOrThrow: vi.fn().mockResolvedValue(undefined),
    assertWithinAiCostCeiling: vi.fn().mockResolvedValue(undefined),
    approvalRequiredTools: new Set<string>(),
    checkDomainAutonomy: vi.fn().mockResolvedValue({ gate: "autonomy", status: "pass" }),
    gateTimeoutMs: 50, // tiny so a "hang" trips the deadline fast
    ...over,
  };
}

const hang = () => new Promise<never>(() => {}); // never resolves

describe("gate stack fails closed when a gate THROWS", () => {
  it("compliance throw → block", async () => {
    const d = await runPolicyGateStack(action, deps({ screenToolCall: vi.fn().mockRejectedValue(new Error("boom")) }));
    expect(d.decision).toBe("block");
    expect(d.decidedBy).toBe("compliance");
  });
  it("quality throw → block", async () => {
    const d = await runPolicyGateStack(action, deps({ gateOutputOrThrow: vi.fn().mockRejectedValue(new Error("boom")) }));
    expect(d.decision).toBe("block");
    expect(d.decidedBy).toBe("quality");
  });
  it("budget throw → block", async () => {
    const d = await runPolicyGateStack(action, deps({ assertWithinAiCostCeiling: vi.fn().mockRejectedValue(new Error("boom")) }));
    expect(d.decision).toBe("block");
    expect(d.decidedBy).toBe("budget");
  });
  it("autonomy throw → block", async () => {
    const d = await runPolicyGateStack(action, deps({ checkDomainAutonomy: vi.fn().mockRejectedValue(new Error("boom")) }));
    expect(d.decision).toBe("block");
    expect(d.decidedBy).toBe("autonomy");
  });
});

describe("gate stack fails closed when a gate HANGS (deadline)", () => {
  it("compliance hang → block", async () => {
    const d = await runPolicyGateStack(action, deps({ screenToolCall: hang as never }));
    expect(d.decision).toBe("block");
    expect(d.decidedBy).toBe("compliance");
  });
  it("budget hang → block", async () => {
    const d = await runPolicyGateStack(action, deps({ assertWithinAiCostCeiling: hang as never }));
    expect(d.decision).toBe("block");
    expect(d.decidedBy).toBe("budget");
  });
  it("autonomy hang → block", async () => {
    const d = await runPolicyGateStack(action, deps({ checkDomainAutonomy: hang as never }));
    expect(d.decision).toBe("block");
    expect(d.decidedBy).toBe("autonomy");
  });
});

describe("gate stack fails closed on a MALFORMED gate response", () => {
  it("compliance returning undefined → block (no silent pass on screen.allowed)", async () => {
    const d = await runPolicyGateStack(action, deps({ screenToolCall: vi.fn().mockResolvedValue(undefined) as never }));
    expect(d.decision).toBe("block");
    expect(d.decidedBy).toBe("compliance");
  });
});

describe("no chaos → the clean action still passes (the deadline doesn't false-trip)", () => {
  it("all gates healthy → pass", async () => {
    const d = await runPolicyGateStack(
      { ...action, toolCall: undefined, output: undefined, isCustomerFacing: false },
      deps(),
    );
    expect(d.decision).toBe("pass");
  });
});
