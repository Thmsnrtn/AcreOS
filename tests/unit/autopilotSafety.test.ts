import { describe, it, expect } from "vitest";
import {
  isHighStakes,
  buildSkepticPrompt,
  parseSkeptic,
  runPremortem,
  calibrationSafetyAction,
  detectDrift,
} from "../../server/services/autopilot/safety";
import type { RankedMove } from "../../server/services/autopilot/decide";
import type { CalibrationReport } from "../../server/services/autopilot/forecast";

const move = (kind: string, domain: RankedMove["domain"]): RankedMove => ({ kind, domain, priority: 4, rationale: "r" });

describe("autopilot frontier safety — adversarial pre-mortem", () => {
  it("flags high-stakes correctly (money or customer-facing)", () => {
    expect(isHighStakes(move("protect_runway", "finance"))).toBe(true);
    expect(isHighStakes(move("clear_support_backlog", "support"))).toBe(true); // customer-facing
    expect(isHighStakes(move("grow_owned_channels", "growth"))).toBe(false); // owned content
    expect(isHighStakes(move("optimize", "ops"))).toBe(false);
  });

  it("the skeptic prompt asks for a pre-mortem and defaults to NOT fatal", () => {
    const p = buildSkepticPrompt(move("clear_support_backlog", "support"));
    expect(p).toMatch(/pre-mortem/i);
    expect(p).toMatch(/fatal=true ONLY for a genuinely serious problem/i);
  });

  it("parseSkeptic validates shape; garbage ⇒ null (no veto)", () => {
    expect(parseSkeptic('{"fatal":true,"objection":"legal risk"}')).toEqual({ fatal: true, objection: "legal risk" });
    expect(parseSkeptic('{"fatal":false,"objection":""}')).toEqual({ fatal: false, objection: "" });
    expect(parseSkeptic("nope")).toBeNull();
    expect(parseSkeptic('{"objection":"no fatal field"}')).toBeNull();
  });

  it("vetoes a high-stakes move when the skeptic finds a fatal flaw", async () => {
    const r = await runPremortem(move("clear_support_backlog", "support"), {
      callModel: async () => '{"fatal":true,"objection":"this could mislead the customer"}',
    });
    expect(r).toEqual({ veto: true, objection: "this could mislead the customer" });
  });

  it("does NOT run for low-stakes moves, and FAILS OPEN on model error (other gates still bind)", async () => {
    expect(await runPremortem(move("grow_owned_channels", "growth"), { callModel: async () => "x" })).toBeNull();
    expect(
      await runPremortem(move("protect_runway", "finance"), { callModel: async () => { throw new Error("down"); } }),
    ).toBeNull();
    // not-fatal skeptic ⇒ no veto
    expect(await runPremortem(move("protect_runway", "finance"), { callModel: async () => '{"fatal":false,"objection":""}' })).toBeNull();
  });
});

describe("autopilot frontier safety — calibration as a safety signal", () => {
  const report = (grade: CalibrationReport["grade"], n = 30): CalibrationReport => ({ grade, n, brier: 0.2, bins: [] });

  it("holds autonomy promotions when the system is over-confident", () => {
    const r = calibrationSafetyAction(report("over-confident"));
    expect(r.holdPromotions).toBe(true);
    expect(r.reason).toMatch(/over-confident/i);
  });

  it("allows promotions when calibration is healthy or simply unproven", () => {
    expect(calibrationSafetyAction(report("well-calibrated")).holdPromotions).toBe(false);
    expect(calibrationSafetyAction(report("fair")).holdPromotions).toBe(false);
    expect(calibrationSafetyAction(report("unproven")).holdPromotions).toBe(false);
  });
});

describe("autopilot frontier safety — constitutional-drift sentinel", () => {
  it("flags a witnessed-send bypass: a customer-facing action that auto-ran", () => {
    const findings = detectDrift([
      { moveKind: "clear_support_backlog", outcome: "acted" }, // customer-facing + acted = bypass
      { moveKind: "grow_owned_channels", outcome: "acted" }, // owned, fine
      { moveKind: "clear_support_backlog", outcome: "escalated" }, // correct path
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: "critical", code: "witnessed_send_bypass" });
    expect(findings[0].message).toMatch(/1 customer-facing/);
  });

  it("clean behavior ⇒ no drift findings", () => {
    expect(
      detectDrift([
        { moveKind: "grow_owned_channels", outcome: "acted" },
        { moveKind: "clear_support_backlog", outcome: "escalated" },
        { moveKind: "optimize", outcome: "suppressed" },
      ]),
    ).toEqual([]);
  });
});
