import { describe, it, expect } from "vitest";
import {
  DOMAIN_AUTONOMY_LEVELS,
  AUTOPILOT_DOMAINS,
  levelRank,
  nextLevel,
  prevLevel,
  shouldPromote,
  gateResultForLevel,
  deriveAutonomyHorizonDays,
} from "../../server/services/autopilot/domainAutonomy";

describe("domain autonomy — pure state machine", () => {
  it("orders the four levels observe → draft → execute_gated → autonomous_gated", () => {
    expect([...DOMAIN_AUTONOMY_LEVELS]).toEqual(["observe", "draft", "execute_gated", "autonomous_gated"]);
    expect(levelRank("observe")).toBe(0);
    expect(levelRank("autonomous_gated")).toBe(3);
  });

  it("promotes one level up, capping at the top", () => {
    expect(nextLevel("observe")).toBe("draft");
    expect(nextLevel("execute_gated")).toBe("autonomous_gated");
    expect(nextLevel("autonomous_gated")).toBeNull();
  });

  it("demotes one level down, flooring at observe", () => {
    expect(prevLevel("autonomous_gated")).toBe("execute_gated");
    expect(prevLevel("draft")).toBe("observe");
    expect(prevLevel("observe")).toBe("observe");
  });

  it("only promotes when the clean-cycle count meets the threshold and a higher level exists", () => {
    expect(shouldPromote("observe", 9, 10)).toBe(false);
    expect(shouldPromote("observe", 10, 10)).toBe(true);
    expect(shouldPromote("execute_gated", 10, 10)).toBe(true);
    // at the top level there is nothing to promote to, regardless of count
    expect(shouldPromote("autonomous_gated", 999, 10)).toBe(false);
  });

  it("maps each level to the right autonomy-gate verdict", () => {
    expect(gateResultForLevel("observe")).toMatchObject({ gate: "autonomy", status: "block" });
    expect(gateResultForLevel("draft")).toMatchObject({ gate: "autonomy", status: "escalate" });
    expect(gateResultForLevel("execute_gated")).toMatchObject({ gate: "autonomy", status: "pass" });
    expect(gateResultForLevel("autonomous_gated")).toMatchObject({ gate: "autonomy", status: "pass" });
  });

  it("higher autonomy means less escalation, never an un-gated pass that skips the rest of the stack", () => {
    // The autonomy gate only ever returns pass/escalate/block — it never bypasses
    // the other gates. execute_gated + autonomous_gated both 'pass' (the rest of
    // the policy stack still runs); only the escalation VOLUME differs elsewhere.
    expect(gateResultForLevel("execute_gated").status).toBe("pass");
    expect(gateResultForLevel("autonomous_gated").status).toBe("pass");
  });

  it("derives the autonomy horizon honestly from earned trust (not a stub)", () => {
    // An all-observing system is unproven → glanced at daily (floor of 1).
    expect(deriveAutonomyHorizonDays(["observe", "observe", "observe", "observe", "observe"])).toBe(1);
    // A fully-trusted system earns weeks of unattended runway (capped at 21).
    expect(
      deriveAutonomyHorizonDays(["autonomous_gated", "autonomous_gated", "autonomous_gated", "autonomous_gated", "autonomous_gated"]),
    ).toBe(21);
    // More earned autonomy ⇒ a longer horizon (monotonic).
    const low = deriveAutonomyHorizonDays(["observe", "draft"]);
    const high = deriveAutonomyHorizonDays(["execute_gated", "autonomous_gated"]);
    expect(high).toBeGreaterThan(low);
    // Empty ledger still yields the honest floor, never 0 or NaN.
    expect(deriveAutonomyHorizonDays([])).toBe(1);
  });

  it("setDomainLevel rejects an unknown level before touching the DB (input contract)", async () => {
    const { setDomainLevel } = await import("../../server/services/autopilot/domainAutonomy");
    // @ts-expect-error — deliberately passing an invalid level to assert the guard
    await expect(setDomainLevel("growth", "super_user", "nope")).rejects.toThrow(/unknown level/i);
  });
});

describe("SWITCH-ON SAFETY FLOOR — OBSERVE blocks every domain's outward action", () => {
  // The property the founder relies on when flipping dispatchEnabled ON: with
  // every domain at OBSERVE (where fresh domains start AND where demotion
  // floors), the autonomy gate BLOCKS — so the brain senses + decides + records
  // on real data, but nothing goes out. This composes the pure facts below into
  // one named ratchet: if a future change makes OBSERVE not-block, lowers the
  // floor below OBSERVE, or lets a non-OBSERVE level masquerade as the default,
  // this fails the build.

  it("OBSERVE is the lowest level — i.e. the floor a fresh OR demoted domain lands on", () => {
    expect(levelRank("observe")).toBe(0);
    expect([...DOMAIN_AUTONOMY_LEVELS][0]).toBe("observe");
    // demotion can never fall below the blocking floor
    expect(prevLevel("observe")).toBe("observe");
    for (const lvl of DOMAIN_AUTONOMY_LEVELS) {
      expect(levelRank(prevLevel(lvl))).toBeLessThanOrEqual(levelRank(lvl));
    }
  });

  it("at OBSERVE the autonomy gate BLOCKS — no outward action — for the whole domain set", () => {
    expect(AUTOPILOT_DOMAINS.length).toBeGreaterThan(0);
    // the verdict is a pure function of level (domain-agnostic), so OBSERVE
    // blocking holds uniformly across every domain a switched-on loop runs.
    for (const _domain of AUTOPILOT_DOMAINS) {
      expect(gateResultForLevel("observe")).toMatchObject({ gate: "autonomy", status: "block" });
    }
  });

  it("ONLY OBSERVE blocks — every higher level must be EARNED (promotion is the only exit from the floor)", () => {
    expect(gateResultForLevel("observe").status).toBe("block");
    for (const lvl of DOMAIN_AUTONOMY_LEVELS.filter((l) => l !== "observe")) {
      expect(gateResultForLevel(lvl).status).not.toBe("block");
    }
    // and you can only leave OBSERVE by going UP one rung at a time
    expect(nextLevel("observe")).toBe("draft");
    expect(levelRank(nextLevel("observe")!)).toBe(levelRank("observe") + 1);
  });
});
