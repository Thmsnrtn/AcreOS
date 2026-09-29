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
 *   4. (ruling 2026-09-29 #11, DEFECT-0159) a 5-DISTINCT-OPERATOR floor on
 *      every distribution and category share — a sample count is not a
 *      privacy floor when one operator can supply all of it.
 */

import { describe, it, expect } from "vitest";
import {
  MIN_COHORT_SIZE,
  MIN_DISTINCT_OPERATORS,
  PRICE_PER_ACRE_BUCKET,
  meetsOperatorFloor,
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
  type OperatorSample,
} from "../../server/services/dataCoop/privacyRollup";

/** Samples spread across distinct operators (operator i % spread + 1). */
function ops(values: number[], spread = MIN_DISTINCT_OPERATORS): OperatorSample[] {
  return values.map((value, i) => ({ value, operator: (i % spread) + 1 }));
}
const FIVE_OPERATORS = [1, 2, 3, 4, 5];

function validInput(overrides: Partial<CountyRollupInput> = {}): CountyRollupInput {
  return {
    state: "tx",
    county: "Bastrop",
    period: "2026-05",
    parcelsObserved: 12,
    observationsInPeriod: 40,
    askedPricePerAcre: ops([4100, 4900, 5300, 6100, 7200]),
    acceptedPricePerAcre: ops([3900, 4400, 4800, 5100, 5600, 6000]),
    daysToResponse: ops([3.2, 7.9, 11.4, 14.1, 21.7]),
    lcsGradeCounts: { A: 3, B: 5, C: 4 },
    lcsOperators: FIVE_OPERATORS,
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
        askedPricePerAcre: ops([5000, 6000]), // 2 < k
        acceptedPricePerAcre: [], // no data at all
        daysToResponse: ops([1, 2, 3, 4]), // 4 < k
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
    expect(computePrivateDistribution(ops([1000, 2000, 3000, 4000]), 500)).toBeNull();
    const dist = computePrivateDistribution(ops([1000, 2000, 3000, 4000, 5000]), 500);
    expect(dist).not.toBeNull();
    expect(dist!.n).toBe(5);
    expect(dist!.median).toBe(3000);
  });

  it("invalid samples (zero/negative/NaN) don't count toward the metric cohort", () => {
    const dist = computePrivateDistribution(ops([0, -50, NaN, 1000, 2000, 3000, 4000], 7), 500);
    expect(dist).toBeNull(); // only 4 valid samples
  });

  it("category distribution is k-gated on total members", () => {
    expect(computeCategoryDistribution({ A: 2, B: 2 }, FIVE_OPERATORS)).toBeNull(); // total 4 < k
    const dist = computeCategoryDistribution({ A: 3, B: 5, C: 4 }, FIVE_OPERATORS);
    expect(dist).not.toBeNull();
    expect(dist!.total).toBe(12);
    expect(dist!.shares.A).toBe(25);
    expect(dist!.shares.B).toBeCloseTo(41.7, 1);
    expect(dist!.shares.C).toBeCloseTo(33.3, 1);
  });
});

describe("5-distinct-operator floor (ruling 2026-09-29 #11, DEFECT-0159)", () => {
  it("ten samples from ONE operator publish nothing — the sample count was never the floor", () => {
    expect(computePrivateDistribution(ops([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000], 1), 500)).toBeNull();
  });

  it("four operators are not enough; five are", () => {
    expect(computePrivateDistribution(ops([1000, 2000, 3000, 4000, 5000, 6000], 4), 500)).toBeNull();
    expect(computePrivateDistribution(ops([1000, 2000, 3000, 4000, 5000]), 500)).not.toBeNull();
  });

  it("an operator whose samples are all invalid does not count toward the floor", () => {
    const samples: OperatorSample[] = [...ops([1000, 2000, 3000, 4000, 5000, 6000], 4), { value: NaN, operator: 99 }];
    expect(computePrivateDistribution(samples, 500)).toBeNull();
  });

  it("a category share needs five operators behind its members, however many members", () => {
    expect(computeCategoryDistribution({ A: 30, B: 50 }, [7])).toBeNull();
    expect(computeCategoryDistribution({ A: 30, B: 50 }, [1, 2, 3, 4])).toBeNull();
    expect(computeCategoryDistribution({ A: 30, B: 50 }, FIVE_OPERATORS)).not.toBeNull();
  });

  it("a county whose priced samples all come from one operator publishes its density, never its prices", () => {
    const row = computeCountyRollup(
      validInput({
        askedPricePerAcre: ops([4100, 4900, 5300, 6100, 7200, 8000], 1),
        acceptedPricePerAcre: ops([3900, 4400, 4800, 5100, 5600, 6000], 1),
        daysToResponse: ops([3, 8, 11, 14, 22], 1),
        lcsOperators: [1],
      }),
    );
    expect(row!.metrics.askedPricePerAcre).toBeNull();
    expect(row!.metrics.acceptedPricePerAcre).toBeNull();
    expect(row!.metrics.daysToResponse).toBeNull();
    expect(row!.metrics.lcsGradeDistribution).toBeNull();
  });

  it("meetsOperatorFloor counts distinct, present operators only", () => {
    expect(MIN_DISTINCT_OPERATORS).toBe(5);
    expect(meetsOperatorFloor([1, 1, 2, 2, 3, 3, 4, 4])).toBe(false);
    expect(meetsOperatorFloor([1, 2, 3, 4, null, undefined, ""])).toBe(false);
    expect(meetsOperatorFloor(["a", "b", "c", "d", "e"])).toBe(true);
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
      ops([4734, 4734, 4734, 4734, 4734]),
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
    // The operator tags samples arrive with never leave.
    expect(serialized).not.toContain("operator");
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
