import { describe, it, expect } from "vitest";
import { outcomeOf } from "../../server/services/autopilot/experienceLog";

describe("autopilot outcomeOf — outward real-world outcomes (Hands P0.3)", () => {
  it("a hard bounce / complaint is a real failure of that send", () => {
    expect(outcomeOf({ deliveryBounced: true })).toBe("failure");
  });

  it("a recovered payment is a real success", () => {
    expect(outcomeOf({ paymentRecovered: true })).toBe("success");
  });

  it("outward outcomes never vote when not observed (no fabrication)", () => {
    expect(outcomeOf({ deliveryBounced: null, paymentRecovered: null })).toBe("pending");
    expect(outcomeOf({})).toBe("pending");
  });

  it("founder verdict still outranks outward outcomes (human ground truth wins)", () => {
    // A bounce happened, but the founder explicitly approved the action.
    expect(outcomeOf({ founderVerdict: "approved", deliveryBounced: true })).toBe("success");
  });

  it("a bad support resolution still outranks a recovered payment", () => {
    expect(outcomeOf({ resolution: "reopened", paymentRecovered: true })).toBe("failure");
  });

  it("outward outcome outranks the mechanical dispatch proxy", () => {
    // dispatch 'succeeded' mechanically, but the email actually bounced.
    expect(outcomeOf({ dispatchSuccess: true, deliveryBounced: true })).toBe("failure");
  });
});
