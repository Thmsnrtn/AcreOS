/**
 * The note acquisition engine, pinned by hand-computed figures.
 *
 * Golden case A — derived payment, no balloon: $50,000 unpaid balance at 9%,
 * 120 months left, no payment entered, bought for $40,000 plus $1,000 costs.
 *   monthly rate  = 9% ÷ 12                                   = 0.75%
 *   payment       = 50,000 × 0.0075 ÷ (1 − 1.0075^−120)
 *                 = 375 ÷ (1 − 1 ÷ 2.4513571)                 = $633.37887 → $633.38
 *   last payment  = the rounded payment overpays 0.113¢ a month; compounded,
 *                   (1.0075^120 − 1.0075) ÷ 0.0075 = 192.514, so the last
 *                   month owes 633.37887 − 0.00113 × 192.514  = $633.16 (rounded)
 *   collected     = 119 × 633.38 + 633.16                     = $76,005.38
 *   total cost    = 40,000 + 1,000                            = $41,000
 *   profit        = 76,005.38 − 41,000                        = $35,005.38
 *   discount      = 1 − 40,000 ÷ 50,000                       = 20%
 *   IRR           = the monthly m with NPV(m) = 0, as (1+m)^12 − 1 ≈ 14.786%
 *                   (solved numerically; the test checks NPV at m is zero)
 *   hold          = 120 months; no balloon, so no payoff_total
 *
 * Golden case B — entered payment, balloon: same note and price, but the note
 * pays $400 a month with the balance due in month 60.
 *   payoff at 60  = 50,000 × 1.0075^60 − 400 × (1.0075^60 − 1.0075) ÷ 0.0075
 *                 = 50,000 × 1.5656810 − 400 × 74.424137
 *                 = 78,284.05 − 29,769.65                     = $48,514.40
 *   collected     = 59 × 400 + 48,514.40                      = $72,114.40
 *   profit        = 72,114.40 − 41,000                        = $31,114.40
 *   hold          = 60 months
 *
 * Identity — bought at par with no costs, the yield IS the note rate,
 * compounded monthly: 1.0075^12 − 1 = 9.3807%. Interest-only at par with a
 * balloon gives the same, with a payoff of 50,000 + 375 = $50,375.
 */
import { describe, expect, it } from "vitest";
import { computeNoteAcquisition, type NoteAcquisitionInputs } from "../../shared/calculators/noteAcquisition";
import { remainingBalanceCents } from "../../shared/calculators/finance";
import { noteAcquisitionEngine } from "../../server/services/economics/engines/noteAcquisition";
import { computeScenario, metricById, ScenarioEngineError } from "../../shared/economics/scenario";
import { ALL_ENGINES } from "../../server/services/economics/engines";
import { NOTE_ACQUISITION_FIELDS } from "../../shared/economics/fields/noteAcquisition";


// The REAL registry — the one the kit's ownership guard and the preview read.
// Registration is part of what is tested: an engine that is not in it cannot
// underwrite anything in production.
const ENGINES = ALL_ENGINES;
it("is registered in ALL_ENGINES, exactly once", () => {
  expect(ALL_ENGINES.filter((e) => e.id === noteAcquisitionEngine.id)).toEqual([noteAcquisitionEngine]);
});

const golden: NoteAcquisitionInputs = {
  unpaidPrincipalCents: 5_000_000,
  noteRatePct: 9,
  remainingTermMonths: 120,
  monthlyPaymentCents: null,
  purchasePriceCents: 4_000_000,
  closingCostsCents: 100_000,
  balloonMonth: null,
};

function npvCents(flows: number[], monthly: number): number {
  return flows.reduce((s, f, t) => s + f / Math.pow(1 + monthly, t), 0);
}

describe("computeNoteAcquisition — golden case A (derived payment, no balloon)", () => {
  const o = computeNoteAcquisition(golden);
  it("derives the level payment and absorbs the rounding in the last one", () => {
    expect(o.paymentDerived).toBe(true);
    expect(o.paymentCents).toBe(63_338);
    expect(o.cashFlowsCents).toHaveLength(121);
    expect(o.cashFlowsCents[0]).toBe(-4_100_000);
    expect(o.cashFlowsCents[119]).toBe(63_338);
    expect(o.finalCollectionCents).toBe(63_316);
  });
  it("cost, collections, profit and discount", () => {
    expect(o.totalCostCents).toBe(4_100_000);
    expect(o.totalCollectedCents).toBe(7_600_538);
    expect(o.profitCents).toBe(3_500_538);
    expect(o.discountToFace).toBeCloseTo(0.2, 12);
  });
  it("IRR is annualised from the monthly rate that zeroes the NPV", () => {
    expect(o.irr).toBeCloseTo(0.14786, 4);
    const monthly = Math.pow(1 + (o.irr as number), 1 / 12) - 1;
    expect(Math.abs(npvCents(o.cashFlowsCents, monthly))).toBeLessThan(1);
  });
  it("hold and balloon", () => {
    expect(o.lastMonth).toBe(120);
    expect(o.paidOffEarly).toBe(false);
    expect(o.balloonPayoffCents).toBeNull();
  });
});

describe("computeNoteAcquisition — golden case B (entered payment, balloon)", () => {
  const o = computeNoteAcquisition({ ...golden, monthlyPaymentCents: 40_000, balloonMonth: 60 });
  it("collects the payment until the balloon, then the payoff", () => {
    expect(o.paymentDerived).toBe(false);
    expect(o.cashFlowsCents).toHaveLength(61);
    expect(o.cashFlowsCents[59]).toBe(40_000);
    expect(o.balloonPayoffCents).toBe(4_851_440);
    expect(o.totalCollectedCents).toBe(7_211_440);
    expect(o.profitCents).toBe(3_111_440);
    expect(o.lastMonth).toBe(60);
  });
  it("IRR zeroes the NPV", () => {
    const monthly = Math.pow(1 + (o.irr as number), 1 / 12) - 1;
    expect(Math.abs(npvCents(o.cashFlowsCents, monthly))).toBeLessThan(1);
    expect(o.irr).toBeCloseTo(0.15065, 4);
  });
});

describe("computeNoteAcquisition — identities", () => {
  it("bought at par with no costs, the yield is the note rate compounded monthly", () => {
    const o = computeNoteAcquisition({ ...golden, purchasePriceCents: 5_000_000, closingCostsCents: null });
    expect(o.irr).toBeCloseTo(Math.pow(1.0075, 12) - 1, 6);
    expect(o.profitCents).toBe(o.totalCollectedCents - 5_000_000);
  });
  it("interest-only at par with a balloon: payoff is balance + one month's interest, yield is the note rate", () => {
    const o = computeNoteAcquisition({ ...golden, monthlyPaymentCents: 37_500, balloonMonth: 36, purchasePriceCents: 5_000_000, closingCostsCents: null });
    expect(o.balloonPayoffCents).toBe(5_037_500);
    expect(o.totalCollectedCents).toBe(35 * 37_500 + 5_037_500);
    expect(o.irr).toBeCloseTo(Math.pow(1.0075, 12) - 1, 6);
  });
  it("with the derived payment, the balloon agrees with finance.ts remainingBalanceCents", () => {
    // payoff at month 60 = that month's payment + the balance after it.
    const o = computeNoteAcquisition({ ...golden, balloonMonth: 60 });
    const canonical = o.paymentCents + remainingBalanceCents(5_000_000, 9, 10, 60);
    expect(Math.abs((o.balloonPayoffCents as number) - canonical)).toBeLessThanOrEqual(100);
  });
  it("a zero-rate note bought at face returns exactly what was paid: no profit, 0% yield", () => {
    const o = computeNoteAcquisition({ ...golden, noteRatePct: 0, remainingTermMonths: 12, purchasePriceCents: 5_000_000, closingCostsCents: null });
    expect(o.paymentCents).toBe(416_667);
    expect(o.totalCollectedCents).toBe(5_000_000);
    expect(o.profitCents).toBe(0);
    expect(o.irr).toBeCloseTo(0, 6);
  });
  it("a payment larger than the level one pays the note off early and collects no more than is owed", () => {
    const o = computeNoteAcquisition({ ...golden, monthlyPaymentCents: 200_000 });
    expect(o.paidOffEarly).toBe(true);
    expect(o.lastMonth).toBeLessThan(120);
    expect(o.finalCollectionCents).toBeLessThanOrEqual(200_000);
    // Never more than the balance plus its interest: well under 120 × $2,000.
    expect(o.totalCollectedCents).toBeLessThan(7_600_538);
  });
  it("a premium price reads as a negative discount", () => {
    expect(computeNoteAcquisition({ ...golden, purchasePriceCents: 5_500_000 }).discountToFace).toBeCloseTo(-0.1, 12);
  });
});

describe("computeNoteAcquisition — refusals (every bound)", () => {
  it("non-positive balance or price", () => {
    expect(() => computeNoteAcquisition({ ...golden, unpaidPrincipalCents: 0 })).toThrow(/Unpaid principal/);
    expect(() => computeNoteAcquisition({ ...golden, purchasePriceCents: 0 })).toThrow(/Purchase price/);
  });
  it("negative costs — a typo would flatter every return", () => {
    expect(() => computeNoteAcquisition({ ...golden, closingCostsCents: -1 })).toThrow(/closingCostsCents/);
  });
  it("note rate outside 0–30%", () => {
    expect(() => computeNoteAcquisition({ ...golden, noteRatePct: -0.1 })).toThrow(/Note rate/);
    expect(() => computeNoteAcquisition({ ...golden, noteRatePct: 30.1 })).toThrow(/Note rate/);
    expect(() => computeNoteAcquisition({ ...golden, noteRatePct: 30 })).not.toThrow();
  });
  it("remaining term not a whole month from 1 to 480", () => {
    expect(() => computeNoteAcquisition({ ...golden, remainingTermMonths: 0 })).toThrow(/Remaining term/);
    expect(() => computeNoteAcquisition({ ...golden, remainingTermMonths: 481 })).toThrow(/Remaining term/);
    expect(() => computeNoteAcquisition({ ...golden, remainingTermMonths: 12.5 })).toThrow(/Remaining term/);
    expect(() => computeNoteAcquisition({ ...golden, remainingTermMonths: 1 })).not.toThrow();
  });
  it("balloon month outside the term or fractional", () => {
    expect(() => computeNoteAcquisition({ ...golden, balloonMonth: 0 })).toThrow(/Balloon month/);
    expect(() => computeNoteAcquisition({ ...golden, balloonMonth: 121 })).toThrow(/Balloon month/);
    expect(() => computeNoteAcquisition({ ...golden, balloonMonth: 6.5 })).toThrow(/Balloon month/);
    expect(() => computeNoteAcquisition({ ...golden, balloonMonth: 120 })).not.toThrow();
  });
  it("a non-positive payment, or one below the interest (the balance would grow)", () => {
    expect(() => computeNoteAcquisition({ ...golden, monthlyPaymentCents: 0 })).toThrow(/Monthly payment/);
    expect(() => computeNoteAcquisition({ ...golden, monthlyPaymentCents: 37_499 })).toThrow(/interest/);
    expect(() => computeNoteAcquisition({ ...golden, monthlyPaymentCents: 37_500 })).not.toThrow();
  });
});

describe("the registered engine", () => {
  const wire = {
    unpaidPrincipalCents: 5_000_000,
    noteRatePct: 9,
    remainingTermMonths: 120,
    purchasePriceCents: 4_000_000,
  };
  const run = (inputs: Record<string, number | string>) =>
    computeScenario({ subjectType: "property", subjectId: 1, label: "x", engineId: "note_acquisition", inputs }, ENGINES);

  it("declares note_investor and its version", () => {
    expect(noteAcquisitionEngine.id).toBe("note_acquisition");
    expect(noteAcquisitionEngine.version).toBe("note-acquisition-1");
    expect(noteAcquisitionEngine.verticals).toEqual(["note_investor"]);
  });

  it("produces only registered metrics, including total_cost and profit for the outcome prompt", () => {
    for (const id of noteAcquisitionEngine.produces) expect(metricById(id), id).toBeDefined();
    expect(noteAcquisitionEngine.produces).toEqual(expect.arrayContaining(["total_cost", "profit"]));
  });

  it("emits every metric it declares, in its registered unit", () => {
    const body = run({ ...wire, closingCostsCents: 100_000 });
    expect(body.metrics.map((m) => m.id).sort()).toEqual([...noteAcquisitionEngine.produces].sort());
    const by = (id: string) => body.metrics.find((m) => m.id === id)!;
    expect(by("total_cost")).toEqual({ id: "total_cost", value: 4_100_000, unit: "cents" });
    expect(by("profit")).toEqual({ id: "profit", value: 3_500_538, unit: "cents" });
    expect(by("discount_to_face").unit).toBe("ratio");
    expect(by("discount_to_face").value).toBeCloseTo(0.2, 12);
    expect(by("irr").unit).toBe("ratio");
    expect(by("irr").value).toBeCloseTo(0.14786, 4);
    expect(by("hold_months")).toEqual({ id: "hold_months", value: 120, unit: "months" });
    // No balloon: undefined, never 0.
    expect(by("payoff_total")).toEqual({ id: "payoff_total", value: null, unit: "cents" });
  });

  it("declares each absent optional input — never a silent $0 or a silent schedule", () => {
    const body = run(wire);
    expect(body.assumptions.map((a) => a.key).sort()).toEqual(["balloon", "closing_costs", "monthly_payment"]);
    const by = (k: string) => body.assumptions.find((a) => a.key === k)!;
    expect(by("closing_costs").origin).toBe("platform-default");
    expect(by("balloon").origin).toBe("platform-default");
    expect(by("monthly_payment").origin).toBe("derived");
    expect(by("monthly_payment").value).toBe("$633.38 a month");
    // The derived payment is the engine's, not an input the operator gave.
    expect(body.inputs).not.toHaveProperty("monthlyPaymentCents");
    expect(body.inputs).not.toHaveProperty("closingCostsCents");
    expect(body.inputs).not.toHaveProperty("balloonMonth");
  });

  it("the operator's own answers are not declared as defaults", () => {
    const body = run({ ...wire, closingCostsCents: 0, monthlyPaymentCents: 63_338, balloonMonth: 120 });
    expect(body.assumptions).toEqual([]);
    expect(body.inputs).toMatchObject({ closingCostsCents: 0, monthlyPaymentCents: 63_338, balloonMonth: 120 });
  });

  it("an entered payment that does not fit the term says so", () => {
    const early = run({ ...wire, closingCostsCents: 0, balloonMonth: 120, monthlyPaymentCents: 200_000 });
    expect(early.assumptions.map((a) => a.key)).toEqual(["early_payoff"]);
    const short = run({ ...wire, closingCostsCents: 0, monthlyPaymentCents: 40_000 });
    expect(short.assumptions.map((a) => a.key).sort()).toEqual(["balloon", "maturity_balance"]);
  });

  it("with a balloon, payoff_total is the balloon payoff", () => {
    const body = run({ ...wire, monthlyPaymentCents: 40_000, balloonMonth: 60 });
    expect(body.metrics.find((m) => m.id === "payoff_total")?.value).toBe(4_851_440);
    expect(body.metrics.find((m) => m.id === "hold_months")?.value).toBe(60);
  });

  it("refuses bad input as a scenario error the route can show", () => {
    expect(() => run({ ...wire, noteRatePct: 45 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, remainingTermMonths: 12.5 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, purchasePriceCents: 1.5 })).toThrow(/integer/);
    expect(() => run({ ...wire, monthlyPaymentCents: 100 })).toThrow(ScenarioEngineError);
    const { noteRatePct: _r, ...missing } = wire;
    expect(() => run(missing)).toThrow(/noteRatePct/);
  });

  it("the form asks for every input the engine reads, with the optional ones optional", () => {
    const keys = NOTE_ACQUISITION_FIELDS.map((f) => f.key).sort();
    expect(keys).toEqual(["balloonMonth", "closingCostsCents", "monthlyPaymentCents", "noteRatePct", "purchasePriceCents", "remainingTermMonths", "unpaidPrincipalCents"]);
    const optional = NOTE_ACQUISITION_FIELDS.filter((f) => f.optional).map((f) => f.key).sort();
    expect(optional).toEqual(["balloonMonth", "closingCostsCents", "monthlyPaymentCents"]);
  });
});
