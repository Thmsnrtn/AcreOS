/**
 * Per-square-foot metrics (Wave 4 Stage 5c) — the last roadmap-for-core item.
 *
 * Commercial rent is quoted per sqft/year. The honesty rule: refuse (null) when
 * the rentable area is unknown or non-positive — a per-sqft figure over a zero or
 * missing denominator is fabricated, so it is never substituted with a guess.
 *
 * W2-COMMERCIAL (2026-11-06) — when these metrics first got a screen, two
 * defaults went: the rent quoted is the ESCALATED rent in effect (not the lease's
 * starting rent), and a missing CAM estimate is no longer read as $0 except on a
 * gross lease, where "none" is what it means.
 */
import { describe, it, expect } from "vitest";
import { computePerSqftMetrics, type PerSqftInput } from "../../shared/rental/perSqft";

/** A flat NNN lease, quoted in Nov 2026 — every case below states what it varies. */
function input(over: Partial<PerSqftInput> = {}): PerSqftInput {
  return {
    monthlyRentCents: 1_000_000,
    scheduleSteps: [],
    asOfMonth: "2026-11",
    rentableSqft: 5_000,
    camEstimateMonthlyCents: null,
    leaseType: "nnn",
    ...over,
  };
}

describe("base rent per sqft / year", () => {
  it("annualizes monthly rent over the rentable area", () => {
    // $10,000/mo × 12 = $120,000/yr ÷ 5,000 sqft = $24.00/sqft = 2400 cents
    const m = computePerSqftMetrics(input());
    expect(m.baseRentPerSqftAnnualCents).toBe(2_400);
    expect(m.monthlyRentCentsUsed).toBe(1_000_000);
    expect(m.asOfMonth).toBe("2026-11");
    expect(m.unavailable).toBe(false);
  });

  it("quotes the ESCALATED rent in effect, not the lease's starting rent", () => {
    // A 3% bump effective Jan 2026: $10,300/mo × 12 ÷ 5,000 = $24.72 = 2472 cents.
    const step = {
      effectiveMonth: "2026-01-01",
      stepType: "fixed_pct" as const,
      amountCents: null,
      pctBps: 300,
      cpiIndexBase: null,
      cpiIndexCurrent: null,
      floorPctBps: null,
      ceilingPctBps: null,
    };
    const m = computePerSqftMetrics(input({ scheduleSteps: [step] }));
    expect(m.monthlyRentCentsUsed).toBe(1_030_000);
    expect(m.baseRentPerSqftAnnualCents).toBe(2_472);
    // A step that has not taken effect by asOfMonth changes nothing.
    const before = computePerSqftMetrics(input({ scheduleSteps: [step], asOfMonth: "2025-12" }));
    expect(before.baseRentPerSqftAnnualCents).toBe(2_400);
  });
});

describe("occupancy cost per sqft / year = (base + CAM) annualized", () => {
  it("adds the CAM estimate to base before annualizing", () => {
    // ($10,000 + $2,000)/mo × 12 = $144,000/yr ÷ 5,000 = $28.80 = 2880 cents
    const m = computePerSqftMetrics(input({ camEstimateMonthlyCents: 200_000 }));
    expect(m.occupancyCostPerSqftAnnualCents).toBe(2_880);
    expect(m.occupancyCostBasis).toBe("base_plus_cam_estimate");
  });

  it("a GROSS lease with no CAM estimate: occupancy cost IS the base rent (rent is all-in)", () => {
    // REWRITTEN (W2-COMMERCIAL), not deleted. This case used to read "treats a
    // null CAM estimate as zero" for every lease. That is true only of a gross
    // lease; it stays true here, and is now said for the reason it is true.
    const m = computePerSqftMetrics(input({ leaseType: "gross" }));
    expect(m.occupancyCostPerSqftAnnualCents).toBe(2_400);
    expect(m.occupancyCostPerSqftAnnualCents).toBe(m.baseRentPerSqftAnnualCents);
    expect(m.occupancyCostBasis).toBe("gross_base_only");
  });

  it("an NNN, modified-gross or unrecorded lease with no CAM estimate: occupancy cost is UNKNOWN, not base", () => {
    for (const leaseType of ["nnn", "modified_gross", null] as const) {
      const m = computePerSqftMetrics(input({ leaseType }));
      expect(m.occupancyCostPerSqftAnnualCents, `leaseType ${leaseType}`).toBeNull();
      expect(m.occupancyCostBasis).toBeNull();
      // The base rent figure is unaffected — only what depends on the missing input is refused.
      expect(m.baseRentPerSqftAnnualCents).toBe(2_400);
    }
  });
});

describe("honesty — refuse rather than divide by a missing/zero denominator", () => {
  it("returns unavailable + null metrics when rentable area is missing", () => {
    const m = computePerSqftMetrics(input({ rentableSqft: null, camEstimateMonthlyCents: 200_000 }));
    expect(m.unavailable).toBe(true);
    expect(m.baseRentPerSqftAnnualCents).toBeNull();
    expect(m.occupancyCostPerSqftAnnualCents).toBeNull();
    expect(m.occupancyCostBasis).toBeNull();
  });

  it("returns unavailable when rentable area is zero (no divide-by-zero fabrication)", () => {
    const m = computePerSqftMetrics(input({ rentableSqft: 0 }));
    expect(m.unavailable).toBe(true);
    expect(m.baseRentPerSqftAnnualCents).toBeNull();
  });

  it("returns null base rent per sqft when the rent itself is unknown", () => {
    const m = computePerSqftMetrics(input({ monthlyRentCents: null }));
    expect(m.baseRentPerSqftAnnualCents).toBeNull();
    expect(m.monthlyRentCentsUsed).toBeNull();
  });
});
