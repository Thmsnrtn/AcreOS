/**
 * The tax-lien bid engine, pinned by hand-computed figures.
 *
 * Golden case: a $10,000 certificate, bid with a $500 premium, earning 18% a
 * year simple, a 5% redemption penalty on face, the premium refunded WITH
 * interest, $200 of registration fees, and the owner redeeming in month 18.
 *   outlay (month 0)   = 10,000 + 500 + 200                      = $10,700
 *   interest on face   = 10,000 × 18% × 18 ÷ 12 = 10,000 × 0.27   = $2,700
 *   penalty            = 10,000 × 5%                             = $500
 *   premium back       = 500 + 500 × 0.27 = 500 + 135            = $635
 *   received (month 18)= 10,000 + 2,700 + 500 + 635              = $13,835
 *   profit             = 13,835 − 10,700                         = $3,135
 *   ROI                = 3,135 ÷ 10,700                          ≈ 29.2991%
 *   annualised simple  = 29.2991% × 12 ÷ 18                      ≈ 19.5327%
 *   IRR                = two flows, so (13,835 ÷ 10,700)^(12/18) − 1
 *                      = 1.2929907^(2/3) − 1; ln 1.2929907 = 0.256966,
 *                        × 2/3 = 0.171311, e^0.171311 = 1.186853 ≈ 18.6853%
 *   hold               = 18 months
 *
 * The other two premium rules, same certificate:
 *   refunded, no interest: received = 10,000 + 2,700 + 500 + 500 = $13,700,
 *                          profit $3,000
 *   forfeited:             received = 10,000 + 2,700 + 500       = $13,200,
 *                          profit $2,500, ROI = 2,500 ÷ 10,700 ≈ 23.3645%
 *
 * Identity: with no premium, no fees and no penalty, the return IS the
 * certificate rate, simple: ROI × 12 ÷ m = rate. At 12% for 12 months the IRR
 * is also exactly 12% (one compounding period).
 */
import { describe, expect, it } from "vitest";
import { computeTaxLienBid, type TaxLienBidInputs } from "../../shared/calculators/taxLienBid";
import { computeIrr } from "../../shared/calculators/landDeal";
import { taxLienBidEngine } from "../../server/services/economics/engines/taxLienBid";
import { computeScenario, metricById, ScenarioEngineError } from "../../shared/economics/scenario";
import { ALL_ENGINES } from "../../server/services/economics/engines";
import { PREMIUM_TREATMENT_BY_CODE, TAX_LIEN_BID_FIELDS } from "../../shared/economics/fields/taxLienBid";

// The REAL registry — the one the kit's ownership guard and the preview read.
// Registration is part of what is tested: an engine not in it underwrites nothing.
const ENGINES = ALL_ENGINES;
it("is registered in ALL_ENGINES, exactly once", () => {
  expect(ALL_ENGINES.filter((e) => e.id === taxLienBidEngine.id)).toEqual([taxLienBidEngine]);
});

const golden: TaxLienBidInputs = {
  faceAmountCents: 1_000_000,
  premiumCents: 50_000,
  interestRatePct: 18,
  penaltyPct: 5,
  premiumTreatment: "refunded_with_interest",
  acquisitionCostsCents: 20_000,
  redemptionMonth: 18,
};

/** The golden case as wire inputs (it has no nulls, so nothing is dropped). */
const goldenWire = golden as unknown as Record<string, number | string>;

describe("computeTaxLienBid — golden case", () => {
  const o = computeTaxLienBid(golden);
  it("outlay at month 0", () => {
    expect(o.totalCostCents).toBe(1_070_000);
  });
  it("what the redemption pays, line by line", () => {
    expect(o.interestOnFaceCents).toBe(270_000);
    expect(o.penaltyCents).toBe(50_000);
    expect(o.premiumReturnedCents).toBe(63_500);
    expect(o.redemptionReceiptsCents).toBe(1_383_500);
  });
  it("profit and returns", () => {
    expect(o.profitCents).toBe(313_500);
    expect(o.roi).toBeCloseTo(0.292991, 6);
    expect(o.annualizedReturn).toBeCloseTo(0.195327, 6);
    expect(o.irr).toBeCloseTo(0.186853, 5);
    expect(o.holdMonths).toBe(18);
  });
  it("the IRR is the closed form of the two-flow timeline", () => {
    expect(o.irr).toBeCloseTo(Math.pow(1_383_500 / 1_070_000, 12 / 18) - 1, 6);
  });
});

describe("computeTaxLienBid — premium rules", () => {
  it("refunded without interest: the premium comes back flat", () => {
    const o = computeTaxLienBid({ ...golden, premiumTreatment: "refunded_no_interest" });
    expect(o.premiumReturnedCents).toBe(50_000);
    expect(o.redemptionReceiptsCents).toBe(1_370_000);
    expect(o.profitCents).toBe(300_000);
  });
  it("forfeited: the premium never comes back", () => {
    const o = computeTaxLienBid({ ...golden, premiumTreatment: "forfeited" });
    expect(o.premiumReturnedCents).toBe(0);
    expect(o.redemptionReceiptsCents).toBe(1_320_000);
    expect(o.profitCents).toBe(250_000);
    expect(o.roi).toBeCloseTo(0.233645, 6);
  });
  it("with no premium, all three rules give the same result", () => {
    const base = { ...golden, premiumCents: 0 };
    const a = computeTaxLienBid({ ...base, premiumTreatment: "refunded_with_interest" });
    const b = computeTaxLienBid({ ...base, premiumTreatment: "refunded_no_interest" });
    const c = computeTaxLienBid({ ...base, premiumTreatment: "forfeited" });
    expect(a.profitCents).toBe(b.profitCents);
    expect(b.profitCents).toBe(c.profitCents);
  });
});

describe("computeTaxLienBid — the honest edges", () => {
  it("identity: face only, no fees, no penalty — the simple return is the certificate rate", () => {
    const o = computeTaxLienBid({ ...golden, premiumCents: 0, penaltyPct: null, acquisitionCostsCents: null, interestRatePct: 12, redemptionMonth: 12 });
    expect(o.totalCostCents).toBe(1_000_000);
    expect(o.profitCents).toBe(120_000);
    expect(o.annualizedReturn).toBeCloseTo(0.12, 10);
    expect(o.irr).toBeCloseTo(0.12, 6);
  });
  it("omitted penalty and fees are excluded, not guessed", () => {
    const o = computeTaxLienBid({ ...golden, penaltyPct: null, acquisitionCostsCents: null });
    expect(o.penaltyCents).toBe(0);
    expect(o.totalCostCents).toBe(1_050_000);
  });
  it("a forfeited premium at 0% is a loss, and the IRR says so", () => {
    const o = computeTaxLienBid({ ...golden, interestRatePct: 0, penaltyPct: null, acquisitionCostsCents: null, premiumTreatment: "forfeited", redemptionMonth: 12 });
    expect(o.profitCents).toBe(-50_000);
    expect(o.roi).toBeCloseTo(-50_000 / 1_050_000, 10);
    expect(o.irr).toBeCloseTo(1_000_000 / 1_050_000 - 1, 6);
  });
  it("getting back exactly what was paid is a 0% IRR, not an undefined one", () => {
    const o = computeTaxLienBid({ ...golden, premiumCents: 0, interestRatePct: 0, penaltyPct: null, acquisitionCostsCents: null });
    expect(o.profitCents).toBe(0);
    expect(o.irr).toBeCloseTo(0, 8);
  });
  it("a fractional-cent interest figure is rounded once, to the cent", () => {
    // 333.33 × 7.25% × 5 ÷ 12 = 10.0694… → $10.07
    const o = computeTaxLienBid({ ...golden, faceAmountCents: 33_333, premiumCents: 0, interestRatePct: 7.25, redemptionMonth: 5 });
    expect(o.interestOnFaceCents).toBe(1_007);
  });
  it("the IRR the calculator reports is computeIrr over the two-flow timeline", () => {
    const flows = new Array<number>(19).fill(0);
    flows[0] = -1_070_000;
    flows[18] = 1_383_500;
    expect(computeTaxLienBid(golden).irr).toBe(computeIrr(flows));
  });
  it("face must be positive", () => {
    expect(() => computeTaxLienBid({ ...golden, faceAmountCents: 0 })).toThrow(/face amount/);
    expect(() => computeTaxLienBid({ ...golden, faceAmountCents: -100 })).toThrow(/face amount/);
  });
  it("negative premium and fees are refused — a typo would move every return", () => {
    expect(() => computeTaxLienBid({ ...golden, premiumCents: -1 })).toThrow(/premiumCents/);
    expect(() => computeTaxLienBid({ ...golden, acquisitionCostsCents: -1 })).toThrow(/acquisitionCostsCents/);
  });
  it("rates and penalties outside 0–100 are refused", () => {
    expect(() => computeTaxLienBid({ ...golden, interestRatePct: -1 })).toThrow(/Interest rate/);
    expect(() => computeTaxLienBid({ ...golden, interestRatePct: 100.5 })).toThrow(/Interest rate/);
    expect(() => computeTaxLienBid({ ...golden, penaltyPct: -1 })).toThrow(/penalty/);
    expect(() => computeTaxLienBid({ ...golden, penaltyPct: 101 })).toThrow(/penalty/);
  });
  it("the redemption month must be a whole number, 1 to 360", () => {
    expect(() => computeTaxLienBid({ ...golden, redemptionMonth: 0 })).toThrow(/Redemption month/);
    expect(() => computeTaxLienBid({ ...golden, redemptionMonth: 361 })).toThrow(/Redemption month/);
    expect(() => computeTaxLienBid({ ...golden, redemptionMonth: 6.5 })).toThrow(/Redemption month/);
    expect(() => computeTaxLienBid({ ...golden, redemptionMonth: -3 })).toThrow(/Redemption month/);
  });
  it("an unknown premium rule is refused, not defaulted", () => {
    expect(() => computeTaxLienBid({ ...golden, premiumTreatment: "kept" as never })).toThrow(/Premium treatment/);
  });
  it("the bounds themselves are accepted", () => {
    expect(() => computeTaxLienBid({ ...golden, interestRatePct: 0, penaltyPct: 0, premiumCents: 0, acquisitionCostsCents: 0, redemptionMonth: 1 })).not.toThrow();
    expect(() => computeTaxLienBid({ ...golden, interestRatePct: 100, penaltyPct: 100, redemptionMonth: 360 })).not.toThrow();
  });
});

describe("the engine (not yet in ALL_ENGINES — composed in by the shim above)", () => {
  const wire = {
    faceAmountCents: 1_000_000,
    premiumCents: 50_000,
    interestRatePct: 18,
    premiumTreatment: 1,
    redemptionMonth: 18,
  };
  const run = (inputs: Record<string, number | string>) =>
    computeScenario({ subjectType: "property", subjectId: 1, label: "x", engineId: "tax_lien_bid", inputs }, ENGINES);

  it("declares tax_lien_deed, under its own id and version", () => {
    expect(taxLienBidEngine.id).toBe("tax_lien_bid");
    expect(taxLienBidEngine.version).toBe("tax-lien-bid-1");
    expect(taxLienBidEngine.verticals).toEqual(["tax_lien_deed"]);
  });

  it("emits every metric it declares, and predicts total_cost and profit so an outcome can grade it", () => {
    const body = run(wire);
    expect(body.metrics.map((m) => m.id).sort()).toEqual([...taxLienBidEngine.produces].sort());
    expect(taxLienBidEngine.produces).toEqual(expect.arrayContaining(["total_cost", "profit"]));
    // No fees, no penalty: outlay 10,500; received 10,000 + 2,700 + 635 = 13,335.
    expect(body.metrics.find((m) => m.id === "total_cost")?.value).toBe(1_050_000);
    expect(body.metrics.find((m) => m.id === "profit")?.value).toBe(283_500);
  });

  it("the golden case, through the registered engine with every metric in its registered unit", () => {
    const body = run(goldenWire);
    for (const m of body.metrics) expect(m.unit).toBe(metricById(m.id)?.unit);
    const v = (id: string) => body.metrics.find((m) => m.id === id)?.value;
    expect(v("total_cost")).toBe(1_070_000);
    expect(v("profit")).toBe(313_500);
    expect(v("roi")).toBeCloseTo(0.292991, 6);
    expect(v("annualized_return")).toBeCloseTo(0.195327, 6);
    expect(v("irr")).toBeCloseTo(0.186853, 5);
    expect(v("hold_months")).toBe(18);
    expect(body.metrics.find((m) => m.id === "roi")?.unit).toBe("ratio");
    expect(body.metrics.find((m) => m.id === "irr")?.unit).toBe("ratio");
    expect(body.metrics.find((m) => m.id === "hold_months")?.unit).toBe("months");
  });

  it("declares each omission as an assumption — never a silent $0", () => {
    const body = run(wire);
    expect(body.assumptions.map((a) => a.key).sort()).toEqual(["acquisition_costs", "redemption_penalty"]);
    expect(body.assumptions.every((a) => a.origin === "platform-default")).toBe(true);
    expect(body.inputs).not.toHaveProperty("penaltyPct");
    expect(body.inputs).not.toHaveProperty("acquisitionCostsCents");
  });

  it("a fully answered form declares nothing", () => {
    expect(run(goldenWire).assumptions).toEqual([]);
  });

  it("a typed 0% penalty and $0 fees are the operator's answers, not defaults", () => {
    const body = run({ ...wire, penaltyPct: 0, acquisitionCostsCents: 0 });
    expect(body.assumptions).toEqual([]);
    expect(body.inputs).toMatchObject({ penaltyPct: 0, acquisitionCostsCents: 0 });
  });

  it("a $0 premium is a real bid: required, recorded, and not declared as a default", () => {
    const body = run({ ...wire, premiumCents: 0 });
    expect(body.inputs).toHaveProperty("premiumCents", 0);
    expect(body.assumptions.map((a) => a.key)).not.toContain("premium");
    const { premiumCents: _p, ...noPremium } = wire;
    expect(() => run(noPremium)).toThrow(/premiumCents/);
  });

  it("the form's premium code and the rule's name compute the same scenario, frozen under the NAME", () => {
    for (const [code, name] of Object.entries(PREMIUM_TREATMENT_BY_CODE)) {
      const byCode = run({ ...wire, premiumTreatment: Number(code) });
      const byName = run({ ...wire, premiumTreatment: name });
      expect(byCode.inputs.premiumTreatment).toBe(name);
      expect(byCode.metrics).toEqual(byName.metrics);
      expect(byCode.inputs).toEqual(byName.inputs);
    }
  });

  it("a frozen scenario recomputes to the same numbers from its own persisted inputs", () => {
    const first = run(wire);
    const again = run(first.inputs);
    expect(again.metrics).toEqual(first.metrics);
    expect(again.inputs).toEqual(first.inputs);
  });

  it("the premium rule is required and refused when it is not one of the three", () => {
    const { premiumTreatment: _t, ...noRule } = wire;
    expect(() => run(noRule)).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, premiumTreatment: 0 })).toThrow(/premiumTreatment/);
    expect(() => run({ ...wire, premiumTreatment: 4 })).toThrow(/premiumTreatment/);
    expect(() => run({ ...wire, premiumTreatment: 1.5 })).toThrow(/premiumTreatment/);
    expect(() => run({ ...wire, premiumTreatment: "kept" })).toThrow(/premiumTreatment/);
  });

  it("refuses bad input as a scenario error the route can show", () => {
    expect(() => run({ ...wire, interestRatePct: 150 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, redemptionMonth: 2.5 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, redemptionMonth: 0 })).toThrow(/Redemption month/);
    expect(() => run({ ...wire, faceAmountCents: 1.5 })).toThrow(/integer/);
    expect(() => run({ ...wire, faceAmountCents: 0 })).toThrow(/face amount/);
    const { redemptionMonth: _m, ...noMonth } = wire;
    expect(() => run(noMonth)).toThrow(/redemptionMonth/);
    const { interestRatePct: _r, ...noRate } = wire;
    expect(() => run(noRate)).toThrow(/interestRatePct/);
  });

});

describe("the form", () => {
  it("names exactly the inputs the engine reads, with the optional ones optional", () => {
    expect(TAX_LIEN_BID_FIELDS.map((f) => f.key).sort()).toEqual(Object.keys(golden).sort());
    expect(TAX_LIEN_BID_FIELDS.filter((f) => f.optional).map((f) => f.key).sort()).toEqual(["acquisitionCostsCents", "penaltyPct"]);
  });
  it("the premium-rule field accepts exactly the codes the engine maps", () => {
    const f = TAX_LIEN_BID_FIELDS.find((x) => x.key === "premiumTreatment")!;
    expect(Object.keys(PREMIUM_TREATMENT_BY_CODE).map(Number)).toEqual([1, 2, 3]);
    expect([f.min, f.max]).toEqual([1, 3]);
    expect(f.unit).toBe("count");
  });
  it("the form's bounds match the calculator's", () => {
    const by = (k: string) => TAX_LIEN_BID_FIELDS.find((x) => x.key === k)!;
    expect([by("interestRatePct").min, by("interestRatePct").max]).toEqual([0, 100]);
    expect([by("penaltyPct").min, by("penaltyPct").max]).toEqual([0, 100]);
    expect([by("redemptionMonth").min, by("redemptionMonth").max]).toEqual([1, 360]);
  });
});
