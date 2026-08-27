/**
 * CROSS-LANE HARD-STOP COVERAGE — every enforcement lane must see every class.
 *
 * The constitutional hard-stops are enforced by three lanes with three input
 * shapes: the executor's checkHardGuardrails (free-text intent), the
 * agent-authority gate's NEVER_PROMOTE_ACTIONS (action ids), and the hands
 * registry's HARD_STOP_HAND_PATTERNS (actuator identity, refused at boot).
 * Different shapes per lane is deliberate. What was NOT deliberate is that
 * nothing tied them together — a class covered in one lane could be invisible
 * in another, silently. Writing this gate found a live instance on 2026-08-28:
 * NEVER_PROMOTE_ACTIONS had NO customer-data-deletion id, so a promotion
 * request for "delete_customer_data" passed isNeverPromote unchecked while the
 * other two lanes both blocked the class.
 *
 * MECHANISM. autopilot/hardStops.ts (the pure single source) declares
 * HARD_STOP_LANE_COVERAGE, a Record keyed by HardStop — so a NEW hard-stop
 * class added without declared coverage is a COMPILE error, exhaustive by
 * type. This file is the runtime half: it drives each lane's REAL gate with
 * the declared probes. No copies of any lane's logic live here — the executor
 * probe runs the exported checkHardGuardrails, the hand probe runs the
 * exported matchHardStopHand, and the never-promote membership is read from
 * the const array literal in agentAuthorityGate.ts's source (for a
 * `as const` string array, the literal IS the runtime value; extraction is
 * vacuity-guarded below, and ENFORCEMENT of that list is separately driven by
 * agentAuthorityCeiling.test.ts, which iterates the same extracted list).
 */
import { describe, it, expect } from "vitest";
import {
  HARD_STOPS,
  HARD_STOP_LANE_COVERAGE,
  matchHardStopHand,
} from "../../server/services/autopilot/hardStops";
import { checkHardGuardrails } from "../../server/services/autonomousDecisionExecutor";
import {
  agentAuthorityGateSource,
  extractNeverPromoteActions,
} from "../helpers/neverPromoteActions";


describe("the coverage map itself is populated (vacuity, first)", () => {
  it("covers every declared hard-stop class — exhaustive by construction", () => {
    // The Record type makes a missing key a compile error; this pins the
    // runtime shape too, so a cast cannot hollow it out.
    expect(HARD_STOPS.length).toBeGreaterThanOrEqual(4);
    for (const hs of HARD_STOPS) {
      expect(HARD_STOP_LANE_COVERAGE[hs], `no coverage declared for ${hs}`).toBeTruthy();
      expect(
        HARD_STOP_LANE_COVERAGE[hs].neverPromoteIds.length,
        `${hs} declares no never-promote ids`,
      ).toBeGreaterThan(0);
    }
  });

  it("the never-promote reconstruction reads the real operational list", () => {
    // A regex that stops matching would drop the operational half silently, and
    // the ceiling test would then drive a shrunken set — fail loudly here first.
    const ids = extractNeverPromoteActions();
    expect(
      ids.length,
      "could not reconstruct the never-promote set — OPERATIONAL_NEVER_PROMOTE " +
        "moved or changed shape in agentAuthorityGate.ts; fix the extraction",
    ).toBeGreaterThanOrEqual(15);
    expect(ids).toContain("infrastructure_scaling"); // operational anchor
    expect(ids).toContain("modify_pricing_plans"); // constitutional anchor
  });
});

describe("every lane sees every hard-stop class", () => {
  it("EXECUTOR: checkHardGuardrails blocks each class's probe — driven, not matched", () => {
    for (const hs of HARD_STOPS) {
      const { executorProbe } = HARD_STOP_LANE_COVERAGE[hs];
      const res = checkHardGuardrails(executorProbe);
      expect(
        res.blocked,
        `${hs}: the executor lane did NOT block its canonical probe ` +
          `${JSON.stringify(executorProbe)} — this class is invisible to ` +
          `checkHardGuardrails, which is exactly the cross-lane blindness this ` +
          `gate exists to forbid`,
      ).toBe(true);
      expect(res.reason.length).toBeGreaterThan(0);
    }
  });

  it("AGENT-AUTHORITY: production DERIVES its constitutional ids from the map", () => {
    // Membership alone became tautological once production composes the map in,
    // so the assertion moves to the semantic property: the composition itself.
    // If someone reverts NEVER_PROMOTE_ACTIONS to a hand-typed list, this goes
    // red — and agentAuthorityCeiling.test.ts independently goes red at runtime,
    // because driving "delete_customer_data" through the real checkAuthority
    // would come back allowed. Two gates, one from each side.
    const src = agentAuthorityGateSource();
    const def = /const NEVER_PROMOTE_ACTIONS[\s\S]*?\];/.exec(src)?.[0] ?? "";
    expect(
      def,
      "NEVER_PROMOTE_ACTIONS no longer derives from HARD_STOP_LANE_COVERAGE — " +
        "a hand-typed list is how the deletion-id gap happened the first time",
    ).toContain("HARD_STOP_LANE_COVERAGE");
    expect(def).toContain("OPERATIONAL_NEVER_PROMOTE");
  });

  it("HANDS: matchHardStopHand classifies each hand-blockable class's probe", () => {
    for (const hs of HARD_STOPS) {
      const { handProbe } = HARD_STOP_LANE_COVERAGE[hs];
      if (handProbe === null) continue; // a recorded design decision, not silence
      expect(
        matchHardStopHand(handProbe.name, handProbe.description),
        `${hs}: HARD_STOP_HAND_PATTERNS does not match its canonical hand probe ` +
          `"${handProbe.name}" — an actuator implementing this class could ` +
          `register at boot`,
      ).toBe(hs);
    }
  });

  it("only spend is exempt from hand-blocking, and that exemption is recorded", () => {
    // A null handProbe is legitimate exactly once today: spend is an AMOUNT
    // property of any action, not a kind of hand, and is enforced by numeric
    // guards. A second null appearing here must be a decision, not a shrug.
    const nulls = HARD_STOPS.filter((hs) => HARD_STOP_LANE_COVERAGE[hs].handProbe === null);
    expect(nulls).toEqual(["spend_over_500_usd"]);
  });
});
