import { describe, it, expect, vi } from "vitest";

// experienceLog imports the db barrel; stub it (these tests exercise pure fns).
vi.mock("../../server/db", () => ({ db: {} }));

import {
  signalsOf,
  deriveTargetRef,
  statsFromExperiences,
  outcomeOf,
} from "../../server/services/autopilot/experienceLog";

// kernel-elevation T0.1 — the #1 truth fix. Before, the aggregators selected
// only 5 fields and dropped deliveryBounced/paymentRecovered, so even a written
// consequence never voted (and nothing wrote it). These lock the fix.

describe("signalsOf — carries the real consequence columns into outcomeOf", () => {
  it("includes deliveryBounced + paymentRecovered (the dropped columns)", () => {
    const s = signalsOf({ dispatchSuccess: true, paymentRecovered: true, deliveryBounced: false });
    expect(s.paymentRecovered).toBe(true);
    expect(s.deliveryBounced).toBe(false);
  });

  it("a recovered payment flips the vote off the mechanical clause", () => {
    // dispatch mechanically FAILED, but the invoice then actually paid → success.
    expect(outcomeOf(signalsOf({ dispatchSuccess: false, paymentRecovered: true }))).toBe("success");
  });

  it("a bounce flips a mechanically-successful send to failure", () => {
    expect(outcomeOf(signalsOf({ dispatchSuccess: true, deliveryBounced: true }))).toBe("failure");
  });

  it("coerces a numeric evalScore and defaults missing fields to null", () => {
    const s = signalsOf({ evalScore: "0.9" as unknown });
    expect(s.evalScore).toBe(0.9);
    expect(s.founderVerdict).toBeNull();
  });
});

describe("statsFromExperiences — now honors the consequence columns", () => {
  it("counts a recovered-payment row as a success even with a failed dispatch", () => {
    const stats = statsFromExperiences([
      { playId: "recover", dispatchSuccess: false, paymentRecovered: true },
    ]);
    expect(stats[0]).toEqual({ playId: "recover", successes: 1, failures: 0 });
  });

  it("counts a bounced send as a failure even with a successful dispatch", () => {
    const stats = statsFromExperiences([
      { playId: "outreach", dispatchSuccess: true, deliveryBounced: true },
    ]);
    expect(stats[0]).toEqual({ playId: "outreach", successes: 0, failures: 1 });
  });
});

describe("deriveTargetRef — the 1:1 webhook join key (else honest abstain)", () => {
  it("an email send keys on the lowercased recipient", () => {
    expect(deriveTargetRef("send_email", { to: "X@Y.com" })).toBe("email:x@y.com");
  });
  it("a dunning action keys on the resolved invoice id", () => {
    expect(deriveTargetRef("dunning_action", { event_id: 5 }, "in_123")).toBe("invoice:in_123");
  });
  it("returns null when there is no clean target (no mis-attribution)", () => {
    expect(deriveTargetRef("run_ad_campaign", { platform: "google" })).toBeNull();
    expect(deriveTargetRef("send_email", {})).toBeNull();
  });
});
