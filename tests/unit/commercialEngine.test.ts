/**
 * The commercial acquisition/hold engine, pinned by hand-computed figures.
 *
 * Golden case (recorded-style fixtures — the flattened form of recorded
 * leases, their rent schedule steps, a recorded CAM reconciliation and the
 * measured expense ledger):
 *   price            $2,000,000 operator-entered
 *   leases           3 recorded
 *   base rent        $15,000/mo recorded
 *   escalated rent   $15,750/mo as of 2026-11 (a recorded +5% step in effect)
 *   CAM recoveries   $2,000/mo from recorded reconciliations
 *   measured op-ex   $6,000/mo, 24 rows over 12 months
 *   expiring ≤12m    $5,250/mo of in-place rent
 *   rentable sqft    10,000
 *   EGI        = (15,750 + 2,000) × 12          = $213,000
 *   NOI        = 213,000 − 72,000               = $141,000
 *   cap rate   = 141,000 / 2,000,000            = 7.05%
 *   OER        = 72,000 / 213,000               ≈ 33.80%
 *   rent/sqft  = 15,750 × 12 / 10,000           = $18.90/yr
 *   rollover   = 5,250 / 15,750                 = 1/3
 */
import { describe, expect, it } from "vitest";
import {
  computeScenario,
  metricValue,
  ScenarioEngineError,
} from "../../shared/economics/scenario";
import { ALL_ENGINES } from "../../server/services/economics/engines";
import { commercialUnderwriteEngine } from "../../server/services/economics/engines/commercialUnderwrite";
import { effectiveBaseRentForMonth } from "../../shared/rental/rentEscalation";

const golden = {
  purchasePriceCents: 200_000_000,
  leaseCount: 3,
  asOfMonth: "2026-11",
  baseMonthlyRentCents: 1_500_000,
  escalatedMonthlyRentCents: 1_575_000,
  expiringWithin12MonthsMonthlyRentCents: 525_000,
  camRecoveriesMonthlyCents: 200_000,
  rentableSqft: 10_000,
  measuredOpExRowCount: 24,
  measuredOpExMonthsCovered: 12,
  measuredOpExMonthlyCents: 600_000,
};

function run(inputs: Record<string, number | string>) {
  return computeScenario(
    { subjectType: "property", subjectId: 1, label: "t", engineId: "commercial_underwrite", inputs },
    ALL_ENGINES,
  );
}

describe("the registered engine", () => {
  it("is in ALL_ENGINES and declares commercial — and only commercial", () => {
    expect(ALL_ENGINES.find((e) => e.id === "commercial_underwrite")).toBe(
      commercialUnderwriteEngine,
    );
    expect(commercialUnderwriteEngine.verticals).toEqual(["commercial"]);
  });

  it("emits every metric it declares, so a decision citing it is gradeable", () => {
    const body = run(golden);
    expect(body.metrics.map((m) => m.id).sort()).toEqual(
      [...commercialUnderwriteEngine.produces].sort(),
    );
    expect(body.engineVersion).toBe(commercialUnderwriteEngine.version);
  });

  it("is deterministic: same recorded inputs, same body out", () => {
    expect(run(golden)).toEqual(run(golden));
  });
});

describe("the golden case", () => {
  const body = run(golden);
  it("income, NOI and cap rate on the operator-entered price", () => {
    expect(metricValue(body, "effective_gross_income")).toBe(21_300_000);
    expect(metricValue(body, "annual_noi")).toBe(14_100_000);
    expect(metricValue(body, "cap_rate")).toBeCloseTo(0.0705, 8);
    expect(metricValue(body, "annual_operating_expense")).toBe(7_200_000);
    expect(metricValue(body, "operating_expense_ratio")).toBeCloseTo(0.338028, 5);
  });
  it("CAM recoveries, per-sqft and rollover exposure", () => {
    expect(metricValue(body, "cam_recoveries_annual")).toBe(2_400_000);
    expect(metricValue(body, "annual_rent_per_sqft")).toBe(1890);
    expect(metricValue(body, "rollover_rent_share_12m")).toBeCloseTo(1 / 3, 8);
  });
  it("declares the price basis and the escalation as assumptions", () => {
    const keys = body.assumptions.map((a) => a.key);
    expect(keys).toContain("valuation_basis");
    expect(keys).toContain("rent_escalation");
    expect(keys).toContain("rollover_exposure");
    expect(body.assumptions.find((a) => a.key === "valuation_basis")?.origin).toBe("user");
  });
});

describe("escalation awareness", () => {
  it("the escalated figure is the one underwritten, not the base", () => {
    // The recorded schedule itself: a +5% fixed_pct step effective 2026-06
    // moves $15,000 to $15,750 — the fixture's escalated figure is derived
    // from rentEscalation, not invented for this test.
    const escalated = effectiveBaseRentForMonth(
      1_500_000,
      [
        {
          effectiveMonth: "2026-06-01",
          stepType: "fixed_pct",
          amountCents: null,
          pctBps: 500,
          cpiIndexBase: null,
          cpiIndexCurrent: null,
          floorPctBps: null,
          ceilingPctBps: null,
        },
      ],
      "2026-11",
    );
    expect(escalated).toBe(1_575_000);
    const flat = run({ ...golden, escalatedMonthlyRentCents: 1_500_000, expiringWithin12MonthsMonthlyRentCents: 500_000 });
    expect(metricValue(run(golden), "annual_noi")).toBeGreaterThan(
      metricValue(flat, "annual_noi") as number,
    );
    expect(metricValue(flat, "effective_gross_income")).toBe(20_400_000);
  });
});

describe("CAM recoveries", () => {
  it("recorded recoveries raise EGI and NOI; unrecorded recoveries are excluded, never assumed", () => {
    const { camRecoveriesMonthlyCents: _omit, ...noCam } = golden;
    const body = run(noCam);
    expect(metricValue(body, "effective_gross_income")).toBe(18_900_000);
    expect(metricValue(body, "cam_recoveries_annual")).toBeNull();
    expect(body.assumptions.map((a) => a.key)).toContain("cam_recoveries");
  });
});

describe("the refusal legs", () => {
  it("unmeasured op-ex: NOI, cap rate and expense ratio are null — no assumed ratio for a commercial lease", () => {
    const { measuredOpExMonthlyCents: _m, ...rest } = golden;
    const body = run({ ...rest, measuredOpExRowCount: 0, measuredOpExMonthsCovered: 0 });
    expect(metricValue(body, "annual_noi")).toBeNull();
    expect(metricValue(body, "cap_rate")).toBeNull();
    expect(metricValue(body, "annual_operating_expense")).toBeNull();
    expect(metricValue(body, "operating_expense_ratio")).toBeNull();
    // Income does not depend on op-ex and still computes.
    expect(metricValue(body, "effective_gross_income")).toBe(21_300_000);
    const refusal = body.assumptions.find((a) => a.key === "operating_expense");
    expect(refusal?.value).toContain("refused");
  });

  it("an operator-supplied ratio is the operator's own answer and does compute", () => {
    const { measuredOpExMonthlyCents: _m, ...rest } = golden;
    const body = run({ ...rest, measuredOpExRowCount: 0, measuredOpExMonthsCovered: 0, opExBps: 3000 });
    // 30% of $17,750/mo income = $5,325/mo op-ex → NOI = $149,100/yr.
    expect(metricValue(body, "annual_noi")).toBe(14_910_000);
    expect(body.assumptions.find((a) => a.key === "operating_expense")?.origin).toBe("user");
  });

  it("measured rows without a measured figure are refused", () => {
    const { measuredOpExMonthlyCents: _m, ...rest } = golden;
    expect(() => run(rest)).toThrow(/measuredOpExMonthlyCents is required/);
  });

  it("missing price is refused — there is no fallback denominator", () => {
    const { purchasePriceCents: _p, ...rest } = golden;
    expect(() => run(rest)).toThrow(ScenarioEngineError);
    expect(() => run({ ...golden, purchasePriceCents: 0 })).toThrow(/positive/);
    expect(() => run({ ...golden, purchasePriceCents: 1.5 })).toThrow(/integer/);
  });

  it("no recorded leases is refused", () => {
    expect(() => run({ ...golden, leaseCount: 0 })).toThrow(/No recorded leases/);
    const { leaseCount: _l, ...rest } = golden;
    expect(() => run(rest)).toThrow(ScenarioEngineError);
  });

  it("rollover larger than the in-place rent is refused as incoherent", () => {
    expect(
      () => run({ ...golden, expiringWithin12MonthsMonthlyRentCents: 1_600_000 }),
    ).toThrow(/cannot exceed/);
  });

  it("a malformed as-of month is refused, never defaulted", () => {
    expect(() => run({ ...golden, asOfMonth: "November" })).toThrow(/asOfMonth/);
  });
});

describe("thin measured coverage is disclosed", () => {
  it("measured op-ex covering 3 of 12 months carries the coverage assumption", () => {
    const body = run({ ...golden, measuredOpExMonthsCovered: 3 });
    expect(metricValue(body, "annual_noi")).toBe(14_100_000);
    expect(body.assumptions.map((a) => a.key)).toContain("operating_expense_coverage");
  });
});
