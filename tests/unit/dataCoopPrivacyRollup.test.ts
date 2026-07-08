/**
 * dataCoopPrivacyRollup.test.ts — Tier 3F cross-org data co-op substrate.
 *
 * Proves the three privacy guarantees the substrate generalizes from
 * marketNetworkContributor:
 *   1. k<5 produces NO rollup row — structurally (computeCountyRollup
 *      returns null; the materialization path only persists non-null).
 *   2. Value bucketing happens BEFORE aggregation (nearest $500/acre),
 *      so no exact deal value survives into a percentile.
 *   3. Org-null output — the rollup shape carries no organization linkage.
 */

import { describe, it, expect } from "vitest";
import {
  MIN_COHORT_SIZE,
  PRICE_PER_ACRE_BUCKET,
  bucketValue,
  computeCategoryDistribution,
  computeCountyRollup,
  computePrivateDistribution,
  percentileValue,
  periodOf,
  periodWindow,
  periodsOfQuarter,
  quarterOf,
  type CountyRollupInput,
} from "../../server/services/dataCoop/privacyRollup";

function validInput(overrides: Partial<CountyRollupInput> = {}): CountyRollupInput {
  return {
    state: "tx",
    county: "Bastrop",
    period: "2026-05",
    parcelsObserved: 12,
    observationsInPeriod: 40,
    askedPricePerAcre: [4100, 4900, 5300, 6100, 7200],
    acceptedPricePerAcre: [3900, 4400, 4800, 5100, 5600, 6000],
    daysToResponse: [3.2, 7.9, 11.4, 14.1, 21.7],
    lcsGradeCounts: { A: 3, B: 5, C: 4 },
    ...overrides,
  };
}

describe("k>=5 cohort floor (structural)", () => {
  it("k<5 contributing parcels produces NO row — null, never a thin rollup", () => {
    for (let k = 0; k < MIN_COHORT_SIZE; k++) {
      expect(computeCountyRollup(validInput({ parcelsObserved: k }))).toBeNull();
    }
  });

  it("k=5 exactly clears the floor", () => {
    const row = computeCountyRollup(validInput({ parcelsObserved: MIN_COHORT_SIZE }));
    expect(row).not.toBeNull();
    expect(row!.cohortSize).toBe(MIN_COHORT_SIZE);
  });

  it("every sub-metric is independently k-gated — thin cohorts go null, never extrapolated", () => {
    const row = computeCountyRollup(
      validInput({
        askedPricePerAcre: [5000, 6000], // 2 < k
        acceptedPricePerAcre: [], // no data at all
        daysToResponse: [1, 2, 3, 4], // 4 < k
      }),
    );
    expect(row).not.toBeNull();
    expect(row!.metrics.askedPricePerAcre).toBeNull();
    expect(row!.metrics.acceptedPricePerAcre).toBeNull();
    expect(row!.metrics.daysToResponse).toBeNull();
    // Density is counts-only and always present once the row exists.
    expect(row!.metrics.parcelObservationDensity.parcelsObserved).toBe(12);
  });

  it("computePrivateDistribution returns null below k and a distribution at k", () => {
    expect(computePrivateDistribution([1000, 2000, 3000, 4000], 500)).toBeNull();
    const dist = computePrivateDistribution([1000, 2000, 3000, 4000, 5000], 500);
    expect(dist).not.toBeNull();
    expect(dist!.n).toBe(5);
    expect(dist!.median).toBe(3000);
  });

  it("invalid samples (zero/negative/NaN) don't count toward the metric cohort", () => {
    const dist = computePrivateDistribution([0, -50, NaN, 1000, 2000, 3000, 4000], 500);
    expect(dist).toBeNull(); // only 4 valid samples
  });

  it("category distribution is k-gated on total members", () => {
    expect(computeCategoryDistribution({ A: 2, B: 2 })).toBeNull(); // total 4 < k
    const dist = computeCategoryDistribution({ A: 3, B: 5, C: 4 });
    expect(dist).not.toBeNull();
    expect(dist!.total).toBe(12);
    expect(dist!.shares.A).toBe(25);
    expect(dist!.shares.B).toBeCloseTo(41.7, 1);
    expect(dist!.shares.C).toBeCloseTo(33.3, 1);
  });
});

describe("value bucketing", () => {
  it("buckets to the nearest step", () => {
    expect(bucketValue(1234, 500)).toBe(1000);
    expect(bucketValue(1250, 500)).toBe(1500); // Math.round half-up
    expect(bucketValue(4999, 500)).toBe(5000);
    expect(bucketValue(0, 500)).toBe(0);
  });

  it("price samples are bucketed BEFORE the percentile, so exact values never survive", () => {
    // Five identical exact prices: $4,734/acre. If bucketing happened after
    // (or not at all) the median would be 4734; bucketed-first it's 4500.
    const dist = computePrivateDistribution(
      [4734, 4734, 4734, 4734, 4734],
      PRICE_PER_ACRE_BUCKET,
    );
    expect(dist!.median).toBe(4500);
    expect(dist!.p25).toBe(4500);
    expect(dist!.p75).toBe(4500);
  });

  it("rollup price metrics land on $500 boundaries", () => {
    const row = computeCountyRollup(validInput());
    const asked = row!.metrics.askedPricePerAcre!;
    for (const v of [asked.median, asked.p25, asked.p75]) {
      expect(v % PRICE_PER_ACRE_BUCKET).toBe(0);
    }
  });

  it("days-to-response is bucketed to whole days", () => {
    const row = computeCountyRollup(validInput());
    const days = row!.metrics.daysToResponse!;
    // Samples [3.2, 7.9, 11.4, 14.1, 21.7] → bucketed [3, 8, 11, 14, 22]
    expect(days.median).toBe(11);
    expect(Number.isInteger(days.p25)).toBe(true);
    expect(Number.isInteger(days.p75)).toBe(true);
  });
});

describe("org-null aggregation", () => {
  it("the rollup output carries NO organization linkage anywhere", () => {
    const row = computeCountyRollup(validInput());
    const serialized = JSON.stringify(row).toLowerCase();
    expect(serialized).not.toContain("organizationid");
    expect(serialized).not.toContain("organization_id");
    expect(serialized).not.toContain("orgid");
    expect(serialized).not.toContain("org_id");
  });

  it("output shape is exactly the org-free contract", () => {
    const row = computeCountyRollup(validInput())!;
    expect(Object.keys(row).sort()).toEqual(
      ["cohortSize", "county", "metrics", "period", "state"].sort(),
    );
    expect(row.state).toBe("TX"); // normalized
    expect(row.county).toBe("Bastrop");
  });
});

describe("period helpers", () => {
  it("periodOf / periodWindow round-trip a UTC month", () => {
    expect(periodOf(new Date(Date.UTC(2026, 5, 10)))).toBe("2026-06");
    const { start, end } = periodWindow("2026-06");
    expect(start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("quarterOf / periodsOfQuarter agree", () => {
    expect(quarterOf(new Date(Date.UTC(2026, 4, 15)))).toBe("2026-Q2");
    expect(periodsOfQuarter("2026-Q2")).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(periodsOfQuarter("2026-Q4")).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(periodsOfQuarter("garbage")).toEqual([]);
  });

  it("percentileValue interpolates linearly", () => {
    expect(percentileValue([10, 20, 30, 40], 50)).toBe(25);
    expect(percentileValue([10], 75)).toBe(10);
    expect(percentileValue([], 50)).toBe(0);
  });
});
