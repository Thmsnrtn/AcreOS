/**
 * Rehab variance arithmetic (fix-and-flip package, Leg 2, §8.2 #8 and #11).
 * Hand-computed fixtures. Committed that was never set is absent, not $0.
 * Flags are facts with true figures. Bid deltas are arithmetic.
 */
import { describe, expect, it } from "vitest";
import { bidVsEstimate, lineVariance, projectVariance, varianceFlags } from "../../shared/rehab/variance";

const L = (id: string, category: string, budget: number, committed: number, spent: number) => ({
  id, category, scope: `${category} scope`, budgetCents: budget, committedCents: committed, spentCents: spent,
});

// Kitchen: estimate 15,000, committed 16,500 (accepted bid), spent 18,240.
// Flooring: estimate 6,000, nothing committed, spent 2,000.
// Paint: estimate 3,000, committed 2,800, spent 0.
const LINES = [
  L("k", "kitchen", 1_500_000, 1_650_000, 1_824_000),
  L("f", "flooring", 600_000, 0, 200_000),
  L("p", "interior_paint", 300_000, 280_000, 0),
];

describe("three-way variance", () => {
  it("per line: estimate, committed, actual, and both differences", () => {
    expect(lineVariance(LINES[0])).toMatchObject({ estimateCents: 1_500_000, committedCents: 1_650_000, actualCents: 1_824_000, actualVsEstimateCents: 324_000, actualVsCommittedCents: 174_000 });
    expect(lineVariance(LINES[2])).toMatchObject({ actualVsEstimateCents: -300_000, actualVsCommittedCents: -280_000 });
  });

  it("a line nothing is committed on has NO committed figure and no committed variance — not $0", () => {
    const f = lineVariance(LINES[1]);
    expect(f.committedCents).toBeNull();
    expect(f.actualVsCommittedCents).toBeNull();
    expect(f.actualVsEstimateCents).toBe(-400_000);
  });

  it("the project roll-up counts committed lines only, and says how many are not committed", () => {
    expect(projectVariance(LINES)).toEqual({
      estimateCents: 2_400_000,
      committedCents: 1_930_000,
      committedLineCount: 2,
      uncommittedLineCount: 1,
      actualCents: 2_024_000,
      actualVsEstimateCents: -376_000,
      // committed lines' actual (1,824,000 + 0) − committed (1,930,000)
      actualVsCommittedCents: -106_000,
    });
    expect(projectVariance([LINES[1]]).actualVsCommittedCents).toBeNull();
  });
});

describe("variance flags are facts", () => {
  it("a line over its estimate flags with its true figures", () => {
    const flags = varianceFlags(LINES);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ kind: "line_actual_over_estimate", lineId: "k", actualCents: 1_824_000, estimateCents: 1_500_000 });
    expect(flags[0].fact).toBe("kitchen scope: spent $18,240 vs $15,000 estimate");
  });

  it("an on-budget project does not flag — no threshold below the fact", () => {
    // 99% of estimate: a platform "warn at 90%" would flag this; a fact does not.
    expect(varianceFlags([L("a", "roof", 1_000_000, 990_000, 990_000)])).toEqual([]);
  });

  it("a cents-level overrun is shown in cents, never as '$15,000 vs $15,000'", () => {
    expect(varianceFlags([L("a", "roof", 1_500_000, 0, 1_500_040)])[0].fact).toBe("roof scope: spent $15,000.40 vs $15,000 estimate");
  });

  it("committed over estimate flags at the project level", () => {
    const flags = varianceFlags([L("a", "roof", 1_000_000, 1_200_000, 0)]);
    expect(flags.map((f) => f.kind)).toEqual(["committed_over_estimate"]);
    expect(flags[0].fact).toBe("Committed $12,000 vs $10,000 estimated across the project's lines");
  });
});

describe("bid vs estimate is arithmetic", () => {
  it("each category's bid beside the project's own estimate for it", () => {
    const deltas = bidVsEstimate({ kitchen: 930_000, flooring: 650_000, roof: 400_000 }, LINES);
    expect(deltas).toEqual([
      { category: "flooring", bidCents: 650_000, estimateCents: 600_000, deltaCents: 50_000, deltaPct: 8.3 },
      { category: "kitchen", bidCents: 930_000, estimateCents: 1_500_000, deltaCents: -570_000, deltaPct: -38 },
      // No estimate in this category: no percentage to compute.
      { category: "roof", bidCents: 400_000, estimateCents: 0, deltaCents: 400_000, deltaPct: null },
    ]);
  });
});
