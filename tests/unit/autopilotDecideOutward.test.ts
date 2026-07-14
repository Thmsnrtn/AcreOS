import { describe, it, expect } from "vitest";
import { rankMoves, sensesFromPulse, type DecisionSenses } from "../../server/services/autopilot/decide";

const calm: DecisionSenses = {
  openIncidents: 0,
  complianceOpenCount: 0,
  envelopeStatus: "green",
  supportBacklog: 0,
  trials: 0,
  activationStalled: false,
  mrr: 0,
  dispatchBacklog: 0,
};

function kinds(s: DecisionSenses): string[] {
  return rankMoves(s).map((m) => m.kind);
}

describe("autopilot decide-core — outward perception moves (Hands P0.2)", () => {
  it("emits no outward moves when all outward channels are quiet/absent", () => {
    const k = kinds(calm);
    expect(k).not.toContain("protect_deliverability");
    expect(k).not.toContain("retain_at_risk");
    expect(k).not.toContain("recover_payments");
    expect(k).not.toContain("convert_trials");
  });

  it("protects deliverability when spam complaints land (ranks above serving)", () => {
    const k = kinds({ ...calm, emailComplaints: 2 });
    expect(k).toContain("protect_deliverability");
    // ranks below stabilize/compliance but above growth
    expect(k.indexOf("protect_deliverability")).toBeLessThan(k.indexOf("grow_owned_channels"));
  });

  it("attempts retention on a churn signal", () => {
    expect(kinds({ ...calm, churnSignals: 1 })).toContain("retain_at_risk");
  });

  it("recovers failed payments on dunning pressure", () => {
    expect(kinds({ ...calm, dunningPressure: 3 })).toContain("recover_payments");
  });

  it("converts ending trials", () => {
    expect(kinds({ ...calm, trialsEnding: 1 })).toContain("convert_trials");
  });

  it("threads outward signals through sensesFromPulse", () => {
    const s = sensesFromPulse(
      { mrr: 0, trials: 0, complianceOpenCount: 0, envelopeStatus: "green", dispatchesFlaggedLast24h: 0 },
      {},
      { emailComplaints: 1, dunningPressure: 2, churnSignals: 1, trialsEnding: 4, dealEvents24h: 6, notePaymentsDueSoon: 3, notePaymentsOverdue: 1 },
    );
    expect(s.emailComplaints).toBe(1);
    expect(s.dunningPressure).toBe(2);
    expect(s.churnSignals).toBe(1);
    expect(s.trialsEnding).toBe(4);
    // Jarvis 2.1 — deal-shaped perception appears in the fused senses.
    expect(s.dealEvents24h).toBe(6);
    expect(s.notePaymentsDueSoon).toBe(3);
    expect(s.notePaymentsOverdue).toBe(1);
  });

  it("defaults deal-shaped senses to the honest zero when unmeasured", () => {
    const s = sensesFromPulse(
      { mrr: 0, trials: 0, complianceOpenCount: 0, envelopeStatus: "green", dispatchesFlaggedLast24h: 0 },
      {},
      {},
    );
    expect(s.dealEvents24h).toBe(0);
    expect(s.notePaymentsDueSoon).toBe(0);
    expect(s.notePaymentsOverdue).toBe(0);
  });
});
