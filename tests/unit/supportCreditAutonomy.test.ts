import { describe, it, expect } from "vitest";
import {
  parseSupportCreditAutonomy,
  SUPPORT_CREDIT_AUTONOMY_KEY,
} from "../../server/services/supportCreditAutonomy";
import { KNOBS } from "../../server/services/founderSettings";

/**
 * Founder-adjustable support-credit autonomy (founder decision, this session).
 * The knob only chooses refuse-vs-log; money never moves under any setting —
 * that safety invariant is pinned by supportAgentMoneyGuard.test.ts, which
 * asserts every money-moving fix returns success:false with no Stripe call.
 */
describe("support-credit autonomy setting", () => {
  it("defaults to 'off' and fails safe for anything unrecognized", () => {
    expect(parseSupportCreditAutonomy(null)).toBe("off");
    expect(parseSupportCreditAutonomy(undefined)).toBe("off");
    expect(parseSupportCreditAutonomy("")).toBe("off");
    expect(parseSupportCreditAutonomy("auto")).toBe("off"); // no autonomous money-move level exists
    expect(parseSupportCreditAutonomy("ON")).toBe("off");
    expect(parseSupportCreditAutonomy("off")).toBe("off");
  });

  it("recognizes the 'propose' level", () => {
    expect(parseSupportCreditAutonomy("propose")).toBe("propose");
  });

  it("is registered as a founder-toggleable safety knob (default off)", () => {
    const knob = KNOBS.find((k) => k.key === SUPPORT_CREDIT_AUTONOMY_KEY);
    expect(knob).toBeDefined();
    expect(knob!.category).toBe("safety");
    expect(knob!.defaultValue).toBe("off");
  });
});
