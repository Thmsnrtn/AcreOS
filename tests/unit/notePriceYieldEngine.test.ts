/**
 * The note price-to-yield engine (`note_price_yield`) — Step 0 items N3+N4.
 *
 * FALSIFYING: on pre-slice main this file fails to import (the engine does not
 * exist), no engine declares `note_investor`, and the kit's ownership guard
 * refuses every note_investor decision.
 *
 * Proves:
 *   - the price is the adopted PR #541 pure function's price, presented in the
 *     shared metric vocabulary — the engine delegates, it does not re-derive;
 *   - a hand-computed zero-rate case lands on the exact cent;
 *   - the price round-trips: paying it yields the target (yieldForPrice);
 *   - it predicts `total_cost` and `profit`, which is what makes a decision
 *     under it gradeable (evidence rule v2);
 *   - acquisition costs enter total cost, and their absence is stated as an
 *     assumption rather than silently read as $0 of cost beyond the price;
 *   - a balloon prices on its own horizon; half a balloon, a zero target and
 *     a balloon larger than the balance it falls due on are all refused;
 *   - the engine is registered properly: in ALL_ENGINES, declaring
 *     note_investor, and the kit preview runs it under that declaration.
 */
import { describe, expect, it } from "vitest";
import { computeScenario, engineById, ScenarioEngineError } from "../../shared/economics/scenario";
import { ALL_ENGINES } from "../../server/services/economics/engines";
import { notePriceYieldEngine } from "../../server/services/economics/engines/notePriceYield";
import { priceForTargetYield, yieldForPrice } from "../../shared/notes/notePriceYield";
import { previewUnderwriting } from "../../server/services/underwriting/verticalDecision";
import { NOTE_PRICE_YIELD_FIELDS } from "../../shared/economics/fields/notePriceYield";
import { wireInputs } from "../../shared/economics/engineFields";

/** A zero-rate note: $12,000 face, $1,000/month, 12 payments left. */
const zeroRate = {
  currentBalanceCents: 1_200_000,
  noteRatePct: 0,
  paymentAmountCents: 100_000,
  remainingTermMonths: 12,
  targetYieldPct: 12,
};

const body = (inputs: Record<string, number>) =>
  computeScenario({ subjectType: "property", subjectId: 1, label: "t", engineId: "note_price_yield", inputs }, ALL_ENGINES);
// wireInputs now carries month-unit fields as strings (the commercial
// desk's `month` unit); this engine's fields are all numeric, and the
// wire tests assert the wired inputs deep-equal the numeric fixture
// before calling metric — so the narrow here is proven, not assumed.
const metric = (inputs: Record<string, number | string>, id: string) => body(inputs as Record<string, number>).metrics.find((m) => m.id === id)?.value;

describe("the arithmetic", () => {
  it("prices the zero-rate note to the exact cent (hand-computed PV)", () => {
    // 12 × $1,000 discounted at (1.12)^(1/12) − 1 monthly = $11,291.52.
    expect(metric(zeroRate, "max_allowable_offer")).toBe(1_129_152);
    expect(metric(zeroRate, "total_cost")).toBe(1_129_152);
    expect(metric(zeroRate, "profit")).toBe(1_200_000 - 1_129_152);
    expect(metric(zeroRate, "hold_months")).toBe(12);
    expect(metric(zeroRate, "irr")).toBeCloseTo(0.12, 12);
    expect(metric(zeroRate, "discount_to_face")).toBeCloseTo(1 - 1_129_152 / 1_200_000, 12);
  });

  it("delegates to the adopted pure function — same price, to the cent", () => {
    const inputs = {
      currentBalanceCents: 10_000_000, // $100,000
      noteRatePct: 10,
      paymentAmountCents: 132_151, // the amortizing payment on $100k / 10% / 120mo
      remainingTermMonths: 120,
      targetYieldPct: 12,
    };
    const direct = priceForTargetYield(
      { currentBalanceCents: 10_000_000, noteRateBps: 1000, paymentAmountCents: 132_151, remainingTermMonths: 120, balloon: null },
      1200,
    );
    expect(direct.ok).toBe(true);
    if (!direct.ok) throw new Error("fixture must price");
    expect(metric(inputs, "max_allowable_offer")).toBe(direct.priceCents);
    // The yield convention is EFFECTIVE annual ((1 + r)^12 − 1, as in
    // computeYields), so a nominal-10% note yields 10.4713% effective — and
    // at THAT target the price is the balance: the identity the whole
    // construction rests on, stated in the convention the code speaks. (At a
    // 10% target the price sits above the balance, correctly: the note's
    // effective yield beats the hurdle.)
    expect(metric({ ...inputs, targetYieldPct: 10 }, "max_allowable_offer")).toBeGreaterThan(10_000_000);
    const atOwnYield = metric({ ...inputs, targetYieldPct: 10.471306744129683 }, "max_allowable_offer") as number;
    expect(Math.abs(atOwnYield - 10_000_000)).toBeLessThan(2_000);
  });

  it("round-trips: paying the engine's price yields the target", () => {
    const price = metric(zeroRate, "max_allowable_offer") as number;
    const back = yieldForPrice(
      { currentBalanceCents: 1_200_000, noteRateBps: 0, paymentAmountCents: 100_000, remainingTermMonths: 12, balloon: null },
      price,
    );
    expect(back.ok).toBe(true);
    if (!back.ok) throw new Error("fixture must solve");
    // The price is rounded to whole cents, so the round-trip lands within
    // that rounding of the target (measured: 7.5e-7), not on it exactly.
    expect(back.annualYield).toBeCloseTo(0.12, 5);
  });

  it("acquisition costs enter total cost and profit; their absence is a stated assumption", () => {
    const withCosts = { ...zeroRate, acquisitionCostsCents: 50_000 };
    expect(metric(withCosts, "total_cost")).toBe(1_129_152 + 50_000);
    expect(metric(withCosts, "profit")).toBe(1_200_000 - 1_129_152 - 50_000);
    expect(body(withCosts).assumptions.find((a) => a.key === "acquisition_costs")).toBeUndefined();

    const bare = body(zeroRate);
    expect(bare.assumptions.find((a) => a.key === "acquisition_costs")?.value).toBe("excluded");
    // The contract-as-stated basis of the profit figure is always frozen.
    expect(bare.assumptions.find((a) => a.key === "contract_as_stated")?.value).toBe(1_200_000);
  });

  it("a balloon prices on the balloon's horizon, not the full term", () => {
    const balloon = {
      currentBalanceCents: 5_000_000,
      noteRatePct: 0,
      paymentAmountCents: 50_000,
      remainingTermMonths: 24,
      targetYieldPct: 10,
      balloonAmountCents: 3_000_000,
      balloonMonth: 12,
    };
    // Flows: 11 × $500, then $500 + $30,000 at month 12 — total $36,000.
    expect(metric(balloon, "hold_months")).toBe(12);
    expect(metric(balloon, "max_allowable_offer")).toBe(3_297_297);
    expect(metric(balloon, "profit")).toBe(3_600_000 - 3_297_297);
  });
});

describe("refusals — never a guessed number", () => {
  it.each([
    ["half a balloon (amount only)", { ...zeroRate, balloonAmountCents: 100_000 }],
    ["half a balloon (month only)", { ...zeroRate, balloonMonth: 6 }],
    ["a zero target yield", { ...zeroRate, targetYieldPct: 0 }],
    ["a negative target yield", { ...zeroRate, targetYieldPct: -3 }],
    // After 6 of the $1,000 payments the zero-rate balance is $6,000 — a
    // $7,000 balloon cannot fall due on it.
    ["a balloon larger than the balance it falls due on", { ...zeroRate, balloonAmountCents: 700_000, balloonMonth: 6 }],
    ["no balance", { ...zeroRate, currentBalanceCents: 0 }],
    ["no payment", { ...zeroRate, paymentAmountCents: 0 }],
  ])("refuses %s", (_label, inputs) => {
    expect(() => body(inputs)).toThrow(ScenarioEngineError);
  });

  it("refuses a missing input rather than defaulting it", () => {
    const { targetYieldPct: _drop, ...noTarget } = zeroRate;
    expect(() => body(noTarget)).toThrow(ScenarioEngineError);
  });
});

describe("registration and the kit", () => {
  it("is in ALL_ENGINES, declaring note_investor and predicting gradeable metrics", () => {
    const found = engineById("note_price_yield", ALL_ENGINES);
    expect(found).toBe(notePriceYieldEngine);
    expect(found?.verticals).toEqual(["note_investor"]);
    expect(found?.produces).toEqual(expect.arrayContaining(["total_cost", "profit"]));
  });

  it("the kit preview runs it — what the desk shows is what gets frozen", () => {
    const preview = previewUnderwriting("note_price_yield", zeroRate);
    expect(preview.engineVersion).toBe(notePriceYieldEngine.version);
    expect(preview.metrics.find((m) => m.id === "total_cost")?.value).toBe(1_129_152);
  });

  it("the desk's field set wires into exactly the inputs the engine consumes", () => {
    const typed: Record<string, string> = {
      currentBalanceCents: "12000",
      noteRatePct: "0",
      paymentAmountCents: "1000",
      remainingTermMonths: "12",
      targetYieldPct: "12",
    };
    const { inputs, missing } = wireInputs(NOTE_PRICE_YIELD_FIELDS, typed);
    expect(missing).toEqual([]);
    expect(inputs).toEqual(zeroRate);
    expect(metric(inputs, "max_allowable_offer")).toBe(1_129_152);
  });
});
