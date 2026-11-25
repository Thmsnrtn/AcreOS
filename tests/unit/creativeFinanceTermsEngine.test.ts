/**
 * The creative-finance origination-terms engine (`creative_finance_terms`)
 * — Step 0 gap sheet creative_finance.md, work item 1 (bar (b), engine only).
 *
 * FALSIFYING: on pre-slice main this file fails to import (the engine does
 * not exist) and no engine declares `creative_finance`.
 *
 * Proves:
 *   - a hand-computed zero-rate golden case lands on the exact cent for
 *     every metric (wrap spread/profit, monthly cash flow, total interest,
 *     balloon amount, total cost);
 *   - an interest-bearing golden case, computed independently from the
 *     shared calculator's formulas, lands on the exact cent — and the two
 *     derivations of profit (cumulative spread + balloon spread, and
 *     equity-principal spread + interest spread) agree;
 *   - the engine delegates to shared/calculators/finance.ts — same
 *     payment and balloon figures, to the cent;
 *   - subject-to and wrap-on-owned variants both structure;
 *   - it predicts `profit` and `total_cost`, which is what makes a
 *     decision under it gradeable (evidence rule v2);
 *   - EVERY required term refused when missing, inconsistent or out of
 *     range — never a guessed rate, term or balance;
 *   - the engine is registered properly: in ALL_ENGINES, declaring
 *     creative_finance, and the kit preview runs it.
 */
import { describe, expect, it } from "vitest";
import { computeScenario, engineById, ScenarioEngineError } from "../../shared/economics/scenario";
import { ALL_ENGINES } from "../../server/services/economics/engines";
import { creativeFinanceTermsEngine } from "../../server/services/economics/engines/creativeFinanceTerms";
import { monthlyPaymentCents, remainingBalanceCents } from "../../shared/calculators/finance";
import { previewUnderwriting } from "../../server/services/underwriting/verticalDecision";

/**
 * Zero-rate golden case (every figure hand-computed):
 *   wrap price $200,000, down $20,000 → wrap principal $180,000 at 0%
 *   over 360 months = $500/month; balloon at month 60 leaves
 *   $180,000 − 60 × $500 = $150,000.
 *   Subject-to: $144,000 balance, stated payment $400/month, 0%, 360
 *   months; payoff at month 60 is $144,000 − 60 × $400 = $120,000.
 *   Cash flow $100/month; interest $0 on both loans; total cost
 *   60 × $400 + $120,000 = $144,000; profit 60 × $100 + ($150,000 −
 *   $120,000) = $36,000 — the equity spread, as it must be at 0%.
 */
const zeroRate = {
  wrapPriceCents: 20_000_000,
  downPaymentCents: 2_000_000,
  wrapRatePct: 0,
  wrapTermMonths: 360,
  balloonMonths: 60,
  subjectToBalanceCents: 14_400_000,
  subjectToPaymentCents: 40_000,
  subjectToRatePct: 0,
  subjectToTermMonths: 360,
};

/**
 * Interest-bearing golden case (computed independently from the shared
 * formulas, then pinned):
 *   wrap price $250,000, down $25,000 → principal $225,000 at 9% over
 *   360 months = $1,810.40/month; balloon at month 84 = $210,691.03.
 *   Subject-to: $160,000 at 4.5% over 300 months = $889.33/month (the
 *   stated payment is the amortizing payment); payoff at month 84 =
 *   $131,494.84. Wrap interest through the balloon $137,764.63;
 *   underlying interest $46,198.56.
 */
const interestBearing = {
  wrapPriceCents: 25_000_000,
  downPaymentCents: 2_500_000,
  wrapRatePct: 9,
  wrapTermMonths: 360,
  balloonMonths: 84,
  subjectToBalanceCents: 16_000_000,
  subjectToPaymentCents: 88_933,
  subjectToRatePct: 4.5,
  subjectToTermMonths: 300,
};

const body = (inputs: Record<string, number>) =>
  computeScenario(
    { subjectType: "property", subjectId: 1, label: "t", engineId: "creative_finance_terms", inputs },
    ALL_ENGINES,
  );
const metric = (inputs: Record<string, number>, id: string) =>
  body(inputs).metrics.find((m) => m.id === id)?.value;

describe("the arithmetic", () => {
  it("lands the hand-computed zero-rate golden case on the exact cent", () => {
    expect(metric(zeroRate, "monthly_cash_flow")).toBe(10_000);
    expect(metric(zeroRate, "balloon_amount")).toBe(15_000_000);
    expect(metric(zeroRate, "total_interest")).toBe(0);
    expect(metric(zeroRate, "total_cost")).toBe(14_400_000);
    expect(metric(zeroRate, "profit")).toBe(3_600_000);
  });

  it("lands the interest-bearing golden case on the exact cent", () => {
    expect(metric(interestBearing, "monthly_cash_flow")).toBe(92_107);
    expect(metric(interestBearing, "balloon_amount")).toBe(21_069_103);
    expect(metric(interestBearing, "total_interest")).toBe(13_776_463);
    expect(metric(interestBearing, "total_cost")).toBe(20_619_856);
    expect(metric(interestBearing, "profit")).toBe(15_656_607);
  });

  it("profit's two derivations agree: cumulative spread + balloon spread = equity spread + interest spread", () => {
    const m = 84;
    const cumulative = m * (metric(interestBearing, "monthly_cash_flow") as number) +
      ((metric(interestBearing, "balloon_amount") as number) - 13_149_484);
    const equityAndInterest =
      (22_500_000 - 16_000_000) + ((metric(interestBearing, "total_interest") as number) - 4_619_856);
    expect(metric(interestBearing, "profit")).toBe(cumulative);
    expect(metric(interestBearing, "profit")).toBe(equityAndInterest);
  });

  it("delegates to the shared finance calculator — same payment and balloons, to the cent", () => {
    const wrapPayment = monthlyPaymentCents(22_500_000, 9, 360 / 12);
    expect(wrapPayment).toBe(181_040);
    expect(metric(interestBearing, "monthly_cash_flow")).toBe(wrapPayment - 88_933);
    expect(metric(interestBearing, "balloon_amount")).toBe(
      remainingBalanceCents(22_500_000, 9, 360 / 12, 84),
    );
    // The underlying payoff is frozen as a derived assumption.
    expect(body(interestBearing).assumptions.find((a) => a.key === "underlying_payoff")?.value).toBe(
      remainingBalanceCents(16_000_000, 4.5, 300 / 12, 84),
    );
  });

  it("structures a wrap on an owned property (second variant, different terms)", () => {
    const owned = {
      wrapPriceCents: 12_000_000,
      downPaymentCents: 1_200_000,
      wrapRatePct: 8,
      wrapTermMonths: 240,
      balloonMonths: 60,
      subjectToBalanceCents: 9_000_000,
      subjectToPaymentCents: 64_479,
      subjectToRatePct: 6,
      subjectToTermMonths: 240,
    };
    expect(metric(owned, "monthly_cash_flow")).toBe(25_857);
    expect(metric(owned, "balloon_amount")).toBe(9_452_763);
    expect(metric(owned, "total_interest")).toBe(4_072_923);
    expect(metric(owned, "total_cost")).toBe(11_509_704);
    expect(metric(owned, "profit")).toBe(3_363_219);
  });

  it("a negative monthly spread is reported, not refused — carrying a wrap can cost monthly and still spread at the balloon", () => {
    const carried = { ...zeroRate, subjectToPaymentCents: 60_000, subjectToTermMonths: 240 };
    expect(metric(carried, "monthly_cash_flow")).toBe(-10_000);
  });
});

describe("refusals — never a guessed number", () => {
  it.each(Object.keys(zeroRate))("refuses a missing %s", (key) => {
    const inputs: Record<string, number> = { ...zeroRate };
    delete inputs[key];
    expect(() => body(inputs)).toThrow(ScenarioEngineError);
    expect(() => body(inputs)).toThrow(new RegExp(key));
  });

  it.each([
    ["a down payment at the wrap price", { ...zeroRate, downPaymentCents: 20_000_000 }],
    ["a down payment above the wrap price", { ...zeroRate, downPaymentCents: 20_000_001 }],
    ["a negative down payment", { ...zeroRate, downPaymentCents: -1 }],
    ["no wrap price", { ...zeroRate, wrapPriceCents: 0 }],
    ["no subject-to balance", { ...zeroRate, subjectToBalanceCents: 0 }],
    ["no subject-to payment", { ...zeroRate, subjectToPaymentCents: 0 }],
    ["a wrap rate past 100", { ...zeroRate, wrapRatePct: 101 }],
    ["a negative subject-to rate", { ...zeroRate, subjectToRatePct: -1 }],
    ["a zero wrap term", { ...zeroRate, wrapTermMonths: 0 }],
    ["a wrap term past 1200 months", { ...zeroRate, wrapTermMonths: 1201 }],
    ["a zero balloon month", { ...zeroRate, balloonMonths: 0 }],
    ["a balloon after the wrap term", { ...zeroRate, balloonMonths: 361 }],
    ["a balloon after the subject-to term", { ...zeroRate, subjectToTermMonths: 59 }],
    ["fractional cents", { ...zeroRate, wrapPriceCents: 20_000_000.5 }],
  ])("refuses %s", (_label, inputs) => {
    expect(() => body(inputs)).toThrow(ScenarioEngineError);
  });
});

describe("registration and the kit", () => {
  it("is in ALL_ENGINES, declaring creative_finance and predicting gradeable metrics", () => {
    const found = engineById("creative_finance_terms", ALL_ENGINES);
    expect(found).toBe(creativeFinanceTermsEngine);
    expect(found?.verticals).toEqual(["creative_finance"]);
    expect(found?.produces).toEqual(expect.arrayContaining(["profit", "total_cost"]));
  });

  it("the kit preview runs it — what a desk would show is what gets frozen", () => {
    const preview = previewUnderwriting("creative_finance_terms", zeroRate);
    expect(preview.engineVersion).toBe(creativeFinanceTermsEngine.version);
    expect(preview.metrics.find((m) => m.id === "profit")?.value).toBe(3_600_000);
  });

  it("the terms-as-stated basis is frozen on every scenario", () => {
    const stated = body(interestBearing).assumptions.find((a) => a.key === "contract_as_stated");
    expect(stated?.value).toBe(84);
    expect(stated?.basis).toContain("balloon");
  });
});
