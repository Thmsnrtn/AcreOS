import { describe, it, expect, vi } from "vitest";
import {
  runPolicyGateStack,
  type PolicyAction,
  type PolicyGateDeps,
} from "../../server/services/autopilot/policyGate";
import { orgScope } from "../../server/services/autopilot/tenantScope";

// A baseline action with no per-gate payloads and not customer-facing.
const baseAction: PolicyAction = {
  domain: "growth",
  actionKind: "run_ads",
  scope: orgScope(1),
  isCustomerFacing: false,
};

// All-pass stubs; individual tests override one.
function passDeps(overrides: Partial<PolicyGateDeps> = {}): Partial<PolicyGateDeps> {
  return {
    screenToolCall: vi.fn().mockResolvedValue({ allowed: true, immutableNumber: null, immutableText: null, reason: "" }),
    assertWithinAiCostCeiling: vi.fn().mockResolvedValue(undefined),
    gateOutputOrThrow: vi.fn().mockResolvedValue(undefined),
    approvalRequiredTools: new Set<string>(),
    checkDomainAutonomy: vi.fn().mockResolvedValue({ gate: "autonomy", status: "pass" }),
    ...overrides,
  };
}

describe("runPolicyGateStack — composed autopilot gate", () => {
  it("passes a clean, non-customer-facing action and skips gates without payloads", async () => {
    const decision = await runPolicyGateStack(baseAction, passDeps());
    expect(decision.decision).toBe("pass");
    // No toolCall/output payloads → those gates are SKIPPED, not silently passed.
    expect(decision.results.find((r) => r.gate === "compliance")?.status).toBe("skipped");
    expect(decision.results.find((r) => r.gate === "quality")?.status).toBe("skipped");
    expect(decision.results.find((r) => r.gate === "budget")?.status).toBe("pass");
  });

  it("hard-errors when an OUTWARD action carries a malformed scope (the move-#2 invariant)", async () => {
    const bad = {
      ...baseAction,
      isCustomerFacing: true,
      scope: { kind: "org", orgId: -1 } as unknown as PolicyAction["scope"],
    };
    await expect(runPolicyGateStack(bad, passDeps())).rejects.toThrow(/malformed scope/);
  });

  it("BLOCKS on the compliance gate and short-circuits (budget never runs)", async () => {
    const assertBudget = vi.fn().mockResolvedValue(undefined);
    const decision = await runPolicyGateStack(
      { ...baseAction, toolCall: { dispatchId: 1, toolName: "send_email", toolInput: {}, agentRole: "soren" } },
      passDeps({
        screenToolCall: vi.fn().mockResolvedValue({ allowed: false, immutableNumber: 7, immutableText: "x", reason: "violates immutable 7" }),
        assertWithinAiCostCeiling: assertBudget,
      }),
    );
    expect(decision.decision).toBe("block");
    expect(decision.decidedBy).toBe("compliance");
    expect(decision.results.at(-1)?.reason).toContain("immutable 7");
    expect(assertBudget).not.toHaveBeenCalled(); // short-circuit
  });

  it("BLOCKS on the quality/eval gate when the eval throws", async () => {
    const decision = await runPolicyGateStack(
      { ...baseAction, output: { surface: "growth_ad", modelKey: "haiku", text: "fabricated stat" } },
      passDeps({ gateOutputOrThrow: vi.fn().mockRejectedValue(new Error("eval gate rejected: PII")) }),
    );
    expect(decision.decision).toBe("block");
    expect(decision.decidedBy).toBe("quality");
    expect(decision.results.at(-1)?.reason).toContain("PII");
  });

  it("BLOCKS on the budget gate when the cost ceiling throws", async () => {
    const decision = await runPolicyGateStack(
      baseAction,
      passDeps({ assertWithinAiCostCeiling: vi.fn().mockRejectedValue(new Error("platform cost ceiling exceeded")) }),
    );
    expect(decision.decision).toBe("block");
    expect(decision.decidedBy).toBe("budget");
  });

  it("BLOCKS on the per-domain autonomy gate when it does not pass", async () => {
    const decision = await runPolicyGateStack(
      baseAction,
      passDeps({ checkDomainAutonomy: vi.fn().mockResolvedValue({ gate: "autonomy", status: "block", reason: "domain at OBSERVE level" }) }),
    );
    expect(decision.decision).toBe("block");
    expect(decision.decidedBy).toBe("autonomy");
    expect(decision.results.at(-1)?.reason).toContain("OBSERVE");
  });

  it("ESCALATES (witnessed-send) for any customer-facing action that otherwise passes", async () => {
    const decision = await runPolicyGateStack({ ...baseAction, isCustomerFacing: true }, passDeps());
    expect(decision.decision).toBe("escalate");
    expect(decision.decidedBy).toBe("witnessed_send");
  });

  it("ESCALATES a public broadcast even when it's NOT customer-facing (no laundering)", async () => {
    const decision = await runPolicyGateStack(
      { ...baseAction, isCustomerFacing: false, outwardClass: "broadcast" },
      passDeps(),
    );
    expect(decision.decision).toBe("escalate");
    expect(decision.decidedBy).toBe("witnessed_send");
  });

  it("ESCALATES when the action's tool is in the witnessed-send approval set", async () => {
    const decision = await runPolicyGateStack(
      { ...baseAction, approvalToolName: "send_sms" },
      passDeps({ approvalRequiredTools: new Set(["send_sms"]) }),
    );
    expect(decision.decision).toBe("escalate");
    expect(decision.decidedBy).toBe("witnessed_send");
  });

  it("runs the gates in order: compliance → quality → budget → autonomy → witnessed", async () => {
    const calls: string[] = [];
    await runPolicyGateStack(
      {
        ...baseAction,
        isCustomerFacing: true,
        toolCall: { dispatchId: 1, toolName: "x", toolInput: {}, agentRole: "soren" },
        output: { surface: "s", modelKey: "m", text: "t" },
      },
      passDeps({
        screenToolCall: vi.fn(async () => { calls.push("compliance"); return { allowed: true, immutableNumber: null, immutableText: null, reason: "" }; }),
        gateOutputOrThrow: vi.fn(async () => { calls.push("quality"); }),
        assertWithinAiCostCeiling: vi.fn(async () => { calls.push("budget"); }),
        checkDomainAutonomy: vi.fn(async () => { calls.push("autonomy"); return { gate: "autonomy", status: "pass" }; }),
      }),
    );
    expect(calls).toEqual(["compliance", "quality", "budget", "autonomy"]);
  });
});
