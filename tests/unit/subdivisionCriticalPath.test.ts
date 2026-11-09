/**
 * Subdivision V1, Leg 4 — the entitlement critical path (§5.5, ruling 3).
 * shared/subdivision/criticalPath.ts is elapsed time against the DECISION RUN'S
 * OWN stated p50/p90, never a county figure. Every date below is hand-computed:
 *
 *   decision recorded 2026-01-01T15:30Z · p50 30 days · p90 60 days
 *   p50 ends 2026-01-31 (Jan 1 + 30)  ·  p90 ends 2026-03-02 (Jan 1 + 60; Feb 2026 has 28 days)
 *
 * All arithmetic is whole UTC days, so the 15:30 time of day on the decision
 * does not move a boundary.
 */
import { describe, expect, it } from "vitest";
import {
  computeCriticalPath,
  type CriticalPathGate,
  type CriticalPathInput,
  type CriticalPathResult,
} from "../../shared/subdivision/criticalPath";

const RECORDED = "2026-01-01T15:30:00Z";
const decision = (over: Partial<NonNullable<CriticalPathInput["decision"]>> = {}) => ({
  recordedAt: RECORDED,
  kind: "pursue",
  timelineP50Days: 30,
  timelineP90Days: 60,
  ...over,
});
const gate = (gateKey: string, sequence: number, status: string, expectedReturnAt: string | null): CriticalPathGate => ({
  gateKey,
  label: `Gate ${gateKey}`,
  sequence,
  status,
  expectedReturnAt,
});
const computed = (input: CriticalPathInput) => {
  const r = computeCriticalPath(input);
  if (r.state !== "computed") throw new Error(`expected computed, got withheld: ${r.reason}`);
  return r;
};
const at = (asOf: string, gates: CriticalPathGate[] = []) => computed({ asOf, decision: decision(), gates });

describe("withheld — a stated answer, never a dressed-up estimate", () => {
  it("no decision → withheld, and the reason names the missing decision", () => {
    const r = computeCriticalPath({ asOf: "2026-02-01", decision: null, gates: [gate("a", 1, "in_review", "2026-02-05")] });
    expect(r).toEqual({
      state: "withheld",
      reason: "No subdivision decision has been recorded for this parcel yet, so there is no stated timeline to measure against.",
    });
  });

  it("a decision with either timeline null → withheld, and the reason names the unstated timeline", () => {
    const reason =
      "The decision on record stated no timeline (p50 and p90), so there is nothing to measure elapsed time against. No timeline is assumed.";
    for (const over of [
      { timelineP50Days: null },
      { timelineP90Days: null },
      { timelineP50Days: null, timelineP90Days: null },
      { timelineP50Days: Number.NaN },
      { timelineP90Days: Number.POSITIVE_INFINITY },
    ]) {
      const r = computeCriticalPath({ asOf: "2026-02-01", decision: decision(over), gates: [] });
      expect(r, JSON.stringify(over)).toEqual({ state: "withheld", reason });
    }
  });

  it("a stated timeline of 0 days is a statement, not an absence", () => {
    const r = computed({ asOf: "2026-01-01", decision: decision({ timelineP50Days: 0, timelineP90Days: 0 }), gates: [] });
    expect(r.p50EndDate).toBe("2026-01-01");
    expect(r.p90EndDate).toBe("2026-01-01");
  });

  it("an unreadable as-of or decision date withholds by name instead of computing NaN", () => {
    expect(computeCriticalPath({ asOf: "not a date", decision: decision(), gates: [] })).toEqual({
      state: "withheld",
      reason: "The as-of date could not be read, so elapsed time is not computed.",
    });
    expect(computeCriticalPath({ asOf: "2026-02-01", decision: decision({ recordedAt: "nope" }), gates: [] })).toEqual({
      state: "withheld",
      reason: "The decision on record carries no readable date, so elapsed time is not computed.",
    });
  });
});

describe("golden arithmetic — end dates, elapsed days, position at every boundary", () => {
  it("p50/p90 end dates are recordedAt + the stated days, whole UTC days", () => {
    const r = at("2026-01-20");
    expect(r.p50EndDate).toBe("2026-01-31");
    expect(r.p90EndDate).toBe("2026-03-02");
  });

  it.each([
    // asOf, elapsed, position
    ["2026-01-01", 0, "within_p50"],
    ["2026-01-30", 29, "within_p50"],
    ["2026-01-31", 30, "within_p50"], // exactly p50: still within
    ["2026-02-01", 31, "between_p50_p90"], // one day past p50
    ["2026-03-02", 60, "between_p50_p90"], // exactly p90: still within p90
    ["2026-03-03", 61, "past_p90"], // one day past p90
    ["2026-06-01", 151, "past_p90"],
  ] as const)("as of %s → %i days elapsed, %s", (asOf, elapsed, position) => {
    const r = at(asOf);
    expect(r.elapsedDays).toBe(elapsed);
    expect(r.position).toBe(position);
  });

  it("time of day does not move a day boundary (15:30 decision, 01:00 as-of on day 30 is still day 30)", () => {
    expect(at("2026-01-31T01:00:00Z").elapsedDays).toBe(30);
    expect(at("2026-01-31T23:59:59Z").elapsedDays).toBe(30);
    expect(at("2026-02-01T00:00:00Z").elapsedDays).toBe(31);
  });

  it("an as-of before the decision clamps elapsed to 0, never negative", () => {
    const r = at("2025-12-15");
    expect(r.elapsedDays).toBe(0);
    expect(r.position).toBe("within_p50");
  });

  it("same inputs, same answer (no clock inside)", () => {
    const input: CriticalPathInput = { asOf: "2026-02-10", decision: decision(), gates: [gate("a", 1, "in_review", "2026-02-05")] };
    expect(computeCriticalPath(input)).toEqual(computeCriticalPath(input));
  });
});

describe("slipped gates", () => {
  const ASOF = "2026-02-10"; // 40 days elapsed
  // Deliberately NOT in sequence order, so ordering is the function's doing.
  const gates = [
    gate("a", 3, "in_review", "2026-02-05"), // 5 days overdue
    gate("b", 1, "submitted", "2026-02-09"), // 1 day overdue
    gate("c", 2, "approved", "2026-01-20"), // closed: never slipped
    gate("d", 4, "skipped", "2026-01-01"), // closed: never slipped
    gate("e", 5, "in_review", "2026-02-10"), // due exactly as-of: not yet slipped (strictly before)
    gate("f", 6, "not_started", "2026-03-15"), // future
    gate("g", 7, "pending", null), // no date: cannot slip
  ];

  it("only OPEN gates whose expected return is strictly before as-of, daysOverdue exact, ordered by sequence", () => {
    const r = at(ASOF, gates);
    expect(r.slippedGates).toEqual([
      { gateKey: "b", label: "Gate b", sequence: 1, expectedReturnAt: "2026-02-09", daysOverdue: 1 },
      { gateKey: "a", label: "Gate a", sequence: 3, expectedReturnAt: "2026-02-05", daysOverdue: 5 },
    ]);
  });

  it("approved and skipped are terminal and never slipped, however stale their date; counts reflect them", () => {
    // The terminal set is pinned behaviourally: exactly the approved gate (c)
    // and the skipped gate (d) count complete in the fixture — see below.
    const r = at(ASOF, gates);
    expect(r.completedGateCount).toBe(2);
    expect(r.openGateCount).toBe(5);
    expect(r.slippedGates.map((g) => g.gateKey)).not.toContain("c");
    expect(r.slippedGates.map((g) => g.gateKey)).not.toContain("d");
  });

  it("any status other than approved/skipped is open — including rejected and unknown vocabulary", () => {
    const r = at(ASOF, [gate("r", 1, "rejected", "2026-02-01"), gate("x", 2, "some_new_status", "2026-02-02")]);
    expect(r.openGateCount).toBe(2);
    expect(r.slippedGates.map((g) => [g.gateKey, g.daysOverdue])).toEqual([
      ["r", 9],
      ["x", 8],
    ]);
  });

  it("a gate date carries no time-of-day effect: as-of mid-day on the return date is 0 overdue → not slipped; next day is 1", () => {
    expect(at("2026-02-10T18:00:00Z", [gate("e", 1, "in_review", "2026-02-10")]).slippedGates).toEqual([]);
    expect(at("2026-02-11T00:00:00Z", [gate("e", 1, "in_review", "2026-02-10")]).slippedGates[0].daysOverdue).toBe(1);
  });
});

describe("projected finish and overrun vs p90", () => {
  it("projectedFinish is the LATEST expected return among OPEN gates; overrun is signed, positive past p90", () => {
    const r = at("2026-02-10", [
      gate("b", 1, "submitted", "2026-02-09"),
      gate("f", 2, "not_started", "2026-03-15"),
      gate("e", 3, "in_review", "2026-02-10"),
      // A CLOSED gate with a later date must not extend the projection.
      gate("z", 4, "approved", "2026-12-01"),
    ]);
    expect(r.projectedFinish).toBe("2026-03-15");
    expect(r.projectedFinishWithheldReason).toBeNull();
    // 2026-03-15 − 2026-03-02 (p90 end) = 13 days
    expect(r.overrunVsP90Days).toBe(13);
  });

  it("overrun is negative when the latest return is inside the p90 date", () => {
    const r = at("2026-02-10", [gate("b", 1, "submitted", "2026-02-09"), gate("f", 2, "not_started", "2026-02-20")]);
    expect(r.projectedFinish).toBe("2026-02-20");
    // 2026-02-20 − 2026-03-02 = −10 days
    expect(r.overrunVsP90Days).toBe(-10);
  });

  it("overrun is exactly 0 on the p90 date", () => {
    const r = at("2026-02-10", [gate("f", 1, "not_started", "2026-03-02")]);
    expect(r.projectedFinish).toBe("2026-03-02");
    expect(r.overrunVsP90Days).toBe(0);
  });

  it("a projected finish already in the past still projects (the latest date the operator recorded)", () => {
    const r = at("2026-04-01", [gate("f", 1, "in_review", "2026-03-10")]);
    expect(r.projectedFinish).toBe("2026-03-10");
    expect(r.overrunVsP90Days).toBe(8);
    expect(r.slippedGates).toHaveLength(1);
  });

  it("open gates with NO dates → projectedFinish null WITH the withheld reason, overrun null; closed gates' dates are not borrowed", () => {
    const r = at("2026-02-10", [
      gate("g", 1, "pending", null),
      gate("h", 2, "in_review", null),
      gate("z", 3, "approved", "2026-12-01"),
    ]);
    expect(r.projectedFinish).toBeNull();
    expect(r.projectedFinishWithheldReason).toBe("No open gate carries an expected return date, so no finish is projected.");
    expect(r.overrunVsP90Days).toBeNull();
    expect(r.slippedGates).toEqual([]);
    expect(r.openGateCount).toBe(2);
  });

  it("no open gates → projectedFinish null with NO withheld reason (nothing left to project), overrun null", () => {
    for (const gates of [[], [gate("a", 1, "approved", "2026-02-01"), gate("b", 2, "skipped", null)]]) {
      const r = at("2026-02-10", gates);
      expect(r.openGateCount).toBe(0);
      expect(r.completedGateCount).toBe(gates.length);
      expect(r.projectedFinish).toBeNull();
      expect(r.projectedFinishWithheldReason).toBeNull();
      expect(r.overrunVsP90Days).toBeNull();
      expect(r.slippedGates).toEqual([]);
    }
  });

  it("an unreadable gate date is skipped, not counted as a projection or a slip", () => {
    const r = at("2026-02-10", [gate("bad", 1, "in_review", "garbage")]);
    expect(r.slippedGates).toEqual([]);
    expect(r.projectedFinish).toBeNull();
    expect(r.projectedFinishWithheldReason).toBe("No open gate carries an expected return date, so no finish is projected.");
  });
});

describe("the module reads no county figure and no clock", () => {
  it("withheld results carry no numeric fields to misread as an estimate", () => {
    const r: CriticalPathResult = computeCriticalPath({ asOf: "2026-02-01", decision: null, gates: [] });
    expect(Object.keys(r).sort()).toEqual(["reason", "state"]);
  });
});
