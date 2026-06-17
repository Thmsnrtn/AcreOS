import { describe, it, expect } from "vitest";
import {
  selectLifecyclePlay,
  lifecyclePlayById,
  LIFECYCLE_PLAYS,
  type LifecycleSituation,
} from "../../server/services/autopilot/lifecyclePlaybook";

const quiet: LifecycleSituation = {
  supportBacklog: 0,
  activationStalled: false,
  dunningPressure: 0,
  churnSignals: 0,
  atLimitCount: 0,
  trialsEnding: 0,
};

describe("lifecycle playbook — play selection (Hands P3)", () => {
  it("returns null when nothing is warranted", () => {
    expect(selectLifecyclePlay(quiet)).toBeNull();
  });

  it("serves a waiting customer before anything else", () => {
    const p = selectLifecyclePlay({ ...quiet, supportBacklog: 1, dunningPressure: 5, churnSignals: 2 });
    expect(p?.id).toBe("support_reply");
  });

  it("recovers revenue before retention/activation", () => {
    expect(selectLifecyclePlay({ ...quiet, dunningPressure: 1, churnSignals: 1, activationStalled: true })?.id).toBe("dunning_recovery");
  });

  it("wins back on a churn signal", () => {
    expect(selectLifecyclePlay({ ...quiet, churnSignals: 1 })?.id).toBe("winback");
  });

  it("unblocks activation, then converts trials, then expands — in that order", () => {
    expect(selectLifecyclePlay({ ...quiet, activationStalled: true, trialsEnding: 1, atLimitCount: 1 })?.id).toBe("activation_nudge");
    expect(selectLifecyclePlay({ ...quiet, trialsEnding: 1, atLimitCount: 1 })?.id).toBe("trial_conversion");
    expect(selectLifecyclePlay({ ...quiet, atLimitCount: 1 })?.id).toBe("expansion_offer");
  });
});

describe("lifecycle playbook — play integrity", () => {
  it("every customer-facing play uses only real registered-hand names + is witnessed", () => {
    const known = new Set(["send_email", "send_sms", "send_push", "send_letter", "dunning_action", "apply_refund"]);
    for (const play of Object.values(LIFECYCLE_PLAYS)) {
      expect(play.hands.length).toBeGreaterThan(0);
      for (const h of play.hands) expect(known.has(h), `${play.id}:${h}`).toBe(true);
    }
    // The only non-customer-facing play is the internal dunning retry.
    const internal = Object.values(LIFECYCLE_PLAYS).filter((p) => !p.isCustomerFacing).map((p) => p.id);
    expect(internal).toEqual(["dunning_recovery"]);
  });

  it("lifecyclePlayById resolves a known id and null otherwise", () => {
    expect(lifecyclePlayById("winback")?.title).toBeTruthy();
    expect(lifecyclePlayById("nope")).toBeNull();
  });
});
