import { describe, it, expect, vi } from "vitest";
import {
  planAndAct,
  moveToPolicyAction,
  bindingFor,
  dispatchPromptFor,
  applyAutonomyFeedback,
  isAutopilotDispatch,
  type ActDeps,
  type ActContext,
} from "../../server/services/autopilot/act";
import type { RankedMove } from "../../server/services/autopilot/decide";
import type { PolicyGateDecision } from "../../server/services/autopilot/policyGate";
import { classifyEscalation } from "../../server/services/autopilot/escalation";

const move = (over: Partial<RankedMove> = {}): RankedMove => ({
  priority: 4,
  domain: "growth",
  kind: "grow_owned_channels",
  rationale: "Stable + within budget — advance owned growth.",
  ...over,
});

const ctx: ActContext = { envelopeStatus: "green", maxCostUsd: 5 };

const gate = (d: PolicyGateDecision["decision"], decidedBy?: PolicyGateDecision["decidedBy"]): PolicyGateDecision => ({
  decision: d,
  results: [],
  decidedBy,
});

function deps(over: Partial<ActDeps> = {}): ActDeps {
  return {
    runGate: vi.fn(async () => gate("pass")),
    classify: classifyEscalation,
    enqueue: vi.fn(async () => 101),
    ask: vi.fn(async () => ({ askId: 202 })),
    ...over,
  };
}

describe("autopilot act() — judgment routed through governance", () => {
  it("maps each move to the right domain + customer-facing flag", () => {
    expect(moveToPolicyAction(move({ kind: "resolve_incident" })).domain).toBe("deploy");
    expect(moveToPolicyAction(move({ kind: "clear_support_backlog" })).isCustomerFacing).toBe(true);
    expect(moveToPolicyAction(move({ kind: "grow_owned_channels" })).isCustomerFacing).toBe(false);
    // unknown move falls back to internal ops, non-customer-facing (safe default)
    expect(bindingFor("totally_unknown")).toMatchObject({ domain: "ops", isCustomerFacing: false });
  });

  it("scopes every autopilot action to the platform (AcreOS operating itself)", () => {
    // The autopilot acts at platform scope, explicitly — not an overloaded null.
    expect(moveToPolicyAction(move({ kind: "grow_owned_channels" })).scope).toEqual({ kind: "platform" });
  });

  it("every outward dispatch prompt carries the craft standard", () => {
    const p = dispatchPromptFor(move({ kind: "grow_owned_channels" }));
    expect(p).toMatch(/genuinely glad to have received it/i);
    expect(p).toMatch(/advance owned growth/);
  });

  it("PASS → enqueues a governed dispatch via auto_dispatch", async () => {
    const d = deps({ runGate: vi.fn(async () => gate("pass")) });
    const out = await planAndAct(move(), ctx, d);
    expect(out.status).toBe("acted");
    expect(d.enqueue).toHaveBeenCalledTimes(1);
    const arg = (d.enqueue as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.sourceType).toBe("auto_dispatch");
    expect(arg.agentRole).toBe("soren");
    expect(arg.maxCostUsd).toBe(5);
    expect(arg.sourceId).toBe("autopilot:grow_owned_channels");
  });

  it("SAFE BY CONSTRUCTION: an autonomy block (OBSERVE) is suppressed — no dispatch, no page", async () => {
    const d = deps({ runGate: vi.fn(async () => gate("block", "autonomy")) });
    const out = await planAndAct(move(), ctx, d);
    // autonomy block → draft-for-review escalation; but it must NOT enqueue work
    expect(d.enqueue).not.toHaveBeenCalled();
    expect(out.status).toBe("escalated");
    if (out.status === "escalated") {
      expect(out.verdict.action).toBe("founder_draft_review");
      expect(d.ask).toHaveBeenCalledTimes(1);
    }
  });

  it("a one-off compliance block is suppressed silently — founder is not asked", async () => {
    const d = deps({ runGate: vi.fn(async () => gate("block", "compliance")), recentBlockCount: vi.fn(async () => 1) });
    const out = await planAndAct(move(), ctx, d);
    expect(out.status).toBe("suppressed");
    expect(d.ask).not.toHaveBeenCalled();
    expect(d.enqueue).not.toHaveBeenCalled();
  });

  it("a structural compliance block (repeated) escalates urgently to the founder", async () => {
    const d = deps({ runGate: vi.fn(async () => gate("block", "compliance")), recentBlockCount: vi.fn(async () => 3) });
    const out = await planAndAct(move(), ctx, d);
    expect(out.status).toBe("escalated");
    if (out.status === "escalated") expect(out.verdict.urgency).toBe("urgent");
    expect(d.ask).toHaveBeenCalledTimes(1);
  });

  it("a customer-facing move forced to witnessed-send asks the founder, never auto-acts", async () => {
    const d = deps({ runGate: vi.fn(async () => gate("escalate", "witnessed_send")) });
    const out = await planAndAct(move({ kind: "clear_support_backlog", domain: "support" }), ctx, d);
    expect(out.status).toBe("escalated");
    expect(d.enqueue).not.toHaveBeenCalled();
    expect(d.ask).toHaveBeenCalledTimes(1);
  });

  it("never throws — a gate failure resolves to an error outcome so the loop survives", async () => {
    const d = deps({ runGate: vi.fn(async () => { throw new Error("db down"); }) });
    const out = await planAndAct(move(), ctx, d);
    expect(out.status).toBe("error");
    if (out.status === "error") expect(out.reason).toMatch(/db down/);
  });
});

describe("autopilot feedback edge — outcomes earn (or cost) autonomy", () => {
  it("a clean autopilot dispatch records a clean cycle for its domain", async () => {
    const recordCleanCycle = vi.fn(async () => "draft");
    const recordAnomaly = vi.fn(async () => "observe");
    const out = await applyAutonomyFeedback(
      { sourceType: "auto_dispatch", sourceId: "autopilot:grow_owned_channels", success: true },
      { recordCleanCycle, recordAnomaly },
    );
    expect(out).toMatchObject({ applied: true, domain: "growth", effect: "clean" });
    expect(recordCleanCycle).toHaveBeenCalledWith("growth");
    expect(recordAnomaly).not.toHaveBeenCalled();
  });

  it("a failed autopilot dispatch records an anomaly (demotion) for its domain", async () => {
    const recordCleanCycle = vi.fn(async () => "observe");
    const recordAnomaly = vi.fn(async () => "observe");
    const out = await applyAutonomyFeedback(
      { sourceType: "auto_dispatch", sourceId: "autopilot:resolve_incident", success: false, terminationReason: "timeout" },
      { recordCleanCycle, recordAnomaly },
    );
    expect(out).toMatchObject({ applied: true, domain: "deploy", effect: "anomaly" });
    expect(recordAnomaly).toHaveBeenCalledTimes(1);
    expect((recordAnomaly as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatch(/timeout/);
  });

  it("a non-autopilot dispatch is ignored — the Trust Ledger is untouched", async () => {
    const recordCleanCycle = vi.fn(async () => "observe");
    const recordAnomaly = vi.fn(async () => "observe");
    const out = await applyAutonomyFeedback(
      { sourceType: "founder_manual", sourceId: "founder:123", success: true },
      { recordCleanCycle, recordAnomaly },
    );
    expect(out.applied).toBe(false);
    expect(recordCleanCycle).not.toHaveBeenCalled();
    expect(recordAnomaly).not.toHaveBeenCalled();
  });

  it("isAutopilotDispatch only matches auto_dispatch with the autopilot: prefix", () => {
    expect(isAutopilotDispatch({ sourceType: "auto_dispatch", sourceId: "autopilot:optimize" })).toBe(true);
    expect(isAutopilotDispatch({ sourceType: "auto_dispatch", sourceId: "detector:42" })).toBe(false);
    expect(isAutopilotDispatch({ sourceType: "founder_manual", sourceId: "autopilot:optimize" })).toBe(false);
  });
});
