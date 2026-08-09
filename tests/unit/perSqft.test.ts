/**
 * Per-square-foot metrics (Wave 4 Stage 5c) — the last roadmap-for-core item.
 *
 * Commercial rent is quoted per sqft/year. The honesty rule: refuse (null) when
 * the rentable area is unknown or non-positive — a per-sqft figure over a zero or
 * missing denominator is fabricated, so it is never substituted with a guess.
 */
import { describe, it, expect } from "vitest";
import { computePerSqftMetrics } from "../../shared/rental/perSqft";

describe("base rent per sqft / year", () => {
  it("annualizes monthly rent over the rentable area", () => {
    // $10,000/mo × 12 = $120,000/yr ÷ 5,000 sqft = $24.00/sqft = 2400 cents
    const m = computePerSqftMetrics({ monthlyRentCents: 1_000_000, rentableSqft: 5_000, camEstimateMonthlyCents: null });
    expect(m.baseRentPerSqftAnnualCents).toBe(2_400);
    expect(m.unavailable).toBe(false);
  });
});

describe("occupancy cost per sqft / year = (base + CAM) annualized", () => {
  it("adds the CAM estimate to base before annualizing", () => {
    // ($10,000 + $2,000)/mo × 12 = $144,000/yr ÷ 5,000 = $28.80 = 2880 cents
    const m = computePerSqftMetrics({ monthlyRentCents: 1_000_000, rentableSqft: 5_000, camEstimateMonthlyCents: 200_000 });
    expect(m.occupancyCostPerSqftAnnualCents).toBe(2_880);
  });

  it("treats a null CAM estimate as zero (occupancy cost equals base rent per sqft)", () => {
    const m = computePerSqftMetrics({ monthlyRentCents: 1_000_000, rentableSqft: 5_000, camEstimateMonthlyCents: null });
    expect(m.occupancyCostPerSqftAnnualCents).toBe(2_400);
    expect(m.occupancyCostPerSqftAnnualCents).toBe(m.baseRentPerSqftAnnualCents);
  });
});

describe("honesty — refuse rather than divide by a missing/zero denominator", () => {
  it("returns unavailable + null metrics when rentable area is missing", () => {
    const m = computePerSqftMetrics({ monthlyRentCents: 1_000_000, rentableSqft: null, camEstimateMonthlyCents: 200_000 });
    expect(m.unavailable).toBe(true);
    expect(m.baseRentPerSqftAnnualCents).toBeNull();
    expect(m.occupancyCostPerSqftAnnualCents).toBeNull();
  });

  it("returns unavailable when rentable area is zero (no divide-by-zero fabrication)", () => {
    const m = computePerSqftMetrics({ monthlyRentCents: 1_000_000, rentableSqft: 0, camEstimateMonthlyCents: null });
    expect(m.unavailable).toBe(true);
    expect(m.baseRentPerSqftAnnualCents).toBeNull();
  });

  it("returns null base rent per sqft when the rent itself is unknown", () => {
    const m = computePerSqftMetrics({ monthlyRentCents: null, rentableSqft: 5_000, camEstimateMonthlyCents: null });
    expect(m.baseRentPerSqftAnnualCents).toBeNull();
  });
});
