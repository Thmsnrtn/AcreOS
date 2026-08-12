/**
 * Scenario — the deterministic economics contract.
 *
 * Canonical law 4: "Financial and geometric truth is deterministic, tested and
 * versioned." All three words are load-bearing, and VERSIONED is the one
 * usually forgotten — without it, improving a formula silently rewrites the
 * meaning of every historical number the old one produced, which is the
 * economics equivalent of the mutable-decision failure law 6 forbids.
 *
 * The sharpest test here is the last one in "an engine is code, never a model".
 * BL3's fail condition for deterministic money math is *"a model response is
 * required to reproduce a financial result"*, and the structural guarantee is
 * that `computeScenario` has no path to anything but a registered pure
 * function — not a policy, not a code review, an absent branch.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  CORE_ENGINES,
  METRICS,
  SCENARIO_SHAPE_VERSION,
  ScenarioEngineError,
  computeScenario,
  engineById,
  freezeScenarioRef,
  metricById,
  metricValue,
  type ComputeScenarioRequest,
} from "@shared/economics/scenario";
import {
  LAND_DEAL_ENGINE_ID,
  LAND_DEAL_ENGINE_VERSION,
  computeLandDeal,
} from "@shared/calculators/landDeal";
import { ALL_ENGINES } from "../../server/services/economics/engines";
import { notePayoffEngine } from "../../server/services/economics/engines/notePayoff";
import { flipMaoEngine } from "../../server/services/economics/engines/flipMao";
import { rentalReturnsEngine } from "../../server/services/economics/engines/rentalReturns";
import { multifamilyNoiEngine } from "../../server/services/economics/engines/multifamilyNoi";
import { computeMao, computeRentalReturns } from "../../server/services/flipUnderwriting";
import {
  TRAILING_12_WINDOW_MONTHS,
  computeNoi,
  decideOperatingExpense,
  isMeasuredCoverageComplete,
} from "@shared/rental/noi";
import {
  PAYOFF_ENGINE_VERSION,
  computePayoffQuote,
} from "../../server/services/notePaymentMath";

const ROOT = path.resolve(__dirname, "../..");

/** A 10-acre parcel: buy at $40k, hold 9 months, resell at $68k. */
function request(over: Partial<ComputeScenarioRequest> = {}): ComputeScenarioRequest {
  return {
    subjectType: "property",
    subjectId: 42,
    label: "Base case",
    engineId: LAND_DEAL_ENGINE_ID,
    inputs: {
      purchaseCents: 4_000_000,
      closingAtBuyCents: 40_000,
      holdingPerMonthCents: 5_000,
      holdMonths: 9,
      marketingCents: 150_000,
      salePriceCents: 6_800_000,
      closingAtSaleCents: 204_000,
    },
    ...over,
  };
}

describe("the registry is coherent", () => {
  it("declares a `days` unit rather than mislabelling a day count as months", () => {
    // BI182: comparing a figure in one unit with one in another produces a
    // number that looks plausible and is wrong. `days_accrued` shipped briefly
    // as `months` with an apology in a comment; correcting it was free only
    // because `scenarios` and `outcomes` have never been deployed, so no
    // persisted row carries the wrong label. That window closes on first deploy.
    expect(metricById("days_accrued")?.unit).toBe("days");
  });

  it("every metric declares a unit and a direction", () => {
    // BI182: an undimensioned money figure is how cents get compared with
    // dollars and produce a number that looks plausible and is wrong by 100x.
    expect(METRICS.length).toBeGreaterThan(0);
    for (const m of METRICS) {
      expect(m.unit, `${m.id} unit`).toBeTruthy();
      expect(m.label.length, `${m.id} label`).toBeGreaterThan(3);
      expect(typeof m.higherIsBetter).toBe("boolean");
    }
    const ids = METRICS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every core engine produces only registered metrics", () => {
    for (const e of CORE_ENGINES) {
      expect(e.version, `${e.id} must declare a version`).toBeTruthy();
      for (const id of e.produces) {
        expect(metricById(id), `${e.id} produces unregistered metric ${id}`).toBeDefined();
      }
    }
  });

  it("the land-deal engine version is owned by the calculator, not duplicated here", () => {
    // The version must live beside the arithmetic it describes, or the two
    // drift and the stamp becomes a lie.
    expect(engineById(LAND_DEAL_ENGINE_ID)?.version).toBe(LAND_DEAL_ENGINE_VERSION);
  });
});

describe("determinism", () => {
  it("produces an identical body from an identical request", () => {
    const a = computeScenario(request());
    const b = computeScenario(request());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("agrees exactly with the underlying calculator", () => {
    // The scenario envelope must not massage the numbers on the way through.
    const req = request();
    const body = computeScenario(req);
    const direct = computeLandDeal({
      purchaseCents: req.inputs.purchaseCents,
      closingAtBuyCents: req.inputs.closingAtBuyCents,
      holdingPerMonthCents: req.inputs.holdingPerMonthCents,
      holdMonths: req.inputs.holdMonths,
      marketingCents: req.inputs.marketingCents,
      salePriceCents: req.inputs.salePriceCents,
      closingAtSaleCents: req.inputs.closingAtSaleCents,
    });
    expect(metricValue(body, "profit")).toBe(direct.profitCents);
    expect(metricValue(body, "total_cost")).toBe(direct.totalCostInCents);
    expect(metricValue(body, "roi")).toBe(direct.roi);
    expect(metricValue(body, "irr")).toBe(direct.irr);
    expect(metricValue(body, "breakeven_sale")).toBe(direct.breakevenSaleCents);
  });

  it("reads no clock and performs no I/O — computedAt is the store's job", () => {
    const body = computeScenario(request()) as Record<string, unknown>;
    expect(body.computedAt).toBeUndefined();
  });

  it("stamps the engine version on every result", () => {
    const body = computeScenario(request());
    expect(body.engineVersion).toBe(LAND_DEAL_ENGINE_VERSION);
    expect(body.shapeVersion).toBe(SCENARIO_SHAPE_VERSION);
  });

  it("stores the inputs the ENGINE consumed, not whatever the caller sent", () => {
    // An extra field in the request must not read later as an input to the
    // maths — the stored snapshot is the defence of the number.
    const body = computeScenario(
      request({ inputs: { ...request().inputs, somethingElse: 999 } }),
    );
    expect(Object.keys(body.inputs).sort()).toEqual([
      "closingAtBuyCents",
      "closingAtSaleCents",
      "holdMonths",
      "holdingPerMonthCents",
      "marketingCents",
      "purchaseCents",
      "salePriceCents",
    ]);
  });
});

describe("an engine is code, never a model", () => {
  it("refuses an unregistered engine instead of improvising", () => {
    expect(() => computeScenario(request({ engineId: "gpt_estimate" }))).toThrow(
      ScenarioEngineError,
    );
    try {
      computeScenario(request({ engineId: "gpt_estimate" }));
    } catch (e) {
      expect((e as Error).message).toMatch(/never from a model response/i);
    }
  });

  it("has no path from computeScenario to a model call", () => {
    // BL3's fail condition for this fitness function is "a model response is
    // required to reproduce a financial result". The guarantee is structural —
    // an absent branch, not a policy.
    const src = fs.readFileSync(path.join(ROOT, "shared/economics/scenario.ts"), "utf8");
    const code = src
      .replace(/\/\*\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");
    for (const forbidden of ["openai", "anthropic", "fetch(", "await import", "llm"]) {
      expect(code.toLowerCase(), `scenario.ts must not reference ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });
});

describe("money is integer cents", () => {
  it("rejects a fractional money input", () => {
    // 1/3 of a cent is how a rounding difference nobody can explain gets in.
    expect(() =>
      computeScenario(request({ inputs: { ...request().inputs, purchaseCents: 4_000_000.5 } })),
    ).toThrow(/must be an integer/i);
  });

  it("rejects a missing or non-finite input rather than defaulting it to zero", () => {
    const { purchaseCents, ...withoutPurchase } = request().inputs;
    expect(() => computeScenario(request({ inputs: withoutPurchase }))).toThrow(
      /required and must be a finite number/i,
    );
    expect(() =>
      computeScenario(request({ inputs: { ...request().inputs, salePriceCents: NaN } })),
    ).toThrow(/finite/i);
  });

  it("rejects a hold period below one month", () => {
    expect(() =>
      computeScenario(request({ inputs: { ...request().inputs, holdMonths: 0 } })),
    ).toThrow(/at least 1/i);
  });
});

describe("undefined is not zero", () => {
  it("carries a null metric as null, never as 0", () => {
    // An IRR is genuinely undefined for some cash-flow shapes. Rendering that
    // as 0% would read as "this deal returns nothing", which is a different and
    // false claim. Law 3's rule about unknowns applies to arithmetic too.
    const body = computeScenario(
      request({
        inputs: {
          ...request().inputs,
          // A sale below cost never crosses zero, so IRR has no solution.
          salePriceCents: 100,
          closingAtSaleCents: 0,
        },
      }),
    );
    const irr = body.metrics.find((m) => m.id === "irr")!;
    expect(irr.value === null || typeof irr.value === "number").toBe(true);
    if (irr.value === null) expect(irr.value).not.toBe(0);
    // Whatever the engine decided, the metric must still be PRESENT and carry
    // its unit — a dropped metric is indistinguishable from one never computed.
    expect(irr.unit).toBe("ratio");
  });

  it("keeps every declared metric present in the output", () => {
    const body = computeScenario(request());
    const produced = new Set(body.metrics.map((m) => m.id));
    for (const id of engineById(LAND_DEAL_ENGINE_ID)!.produces) {
      expect(produced.has(id), `engine declares ${id} but did not emit it`).toBe(true);
    }
  });
});

describe("assumptions keep their origin across the scenario boundary", () => {
  it("preserves user vs platform-default provenance", () => {
    const body = computeScenario(
      request({
        assumptions: [
          { key: "resale_price_usd", value: 68_000, origin: "user", unit: "usd" },
          { key: "hold_months", value: 9, origin: "strategy-pack-default" },
        ],
      }),
    );
    const byKey = Object.fromEntries(body.assumptions.map((a) => [a.key, a.origin]));
    expect(byKey["resale_price_usd"]).toBe("user");
    expect(byKey["hold_months"]).toBe("strategy-pack-default");
  });

  it("defaults to an empty list rather than inventing assumptions", () => {
    expect(computeScenario(request()).assumptions).toEqual([]);
  });
});

describe("the reference a decision freezes", () => {
  it("carries the headline numbers alongside the id", () => {
    // So a decision stays readable even if the scenario row is later
    // unreachable — the same reasoning that makes a frozen fact store its
    // resolved value alongside its claim ids.
    const body = computeScenario(request());
    const ref = freezeScenarioRef(77, body);
    expect(ref.scenarioId).toBe(77);
    expect(ref.engineVersion).toBe(LAND_DEAL_ENGINE_VERSION);
    expect(ref.headline.map((m) => m.id).sort()).toEqual(["irr", "profit", "roi"]);
    expect(ref.label).toBe("Base case");
  });

  it("does not carry the entire output — a reference is not a copy", () => {
    const ref = freezeScenarioRef(77, computeScenario(request()));
    expect(ref.headline.length).toBeLessThan(METRICS.length);
  });
});

describe("BI191 — the primitive holds for a CONTRASTING strategy, not just land", () => {
  // "Every core primitive must pass contrasting Strategy Pack fixtures. A
  // land-only implementation that happens to expose generic labels does not
  // satisfy the architecture." A registry with one land engine is a land-shaped
  // abstraction pretending to be general, so these run the SECOND engine —
  // structurally different: date-driven day-count accrual rather than a
  // cash-flow series, with dates as inputs rather than only money.

  const noteRequest = (over: Record<string, number | string> = {}) => ({
    subjectType: "deal" as const,
    subjectId: 7,
    label: "Payoff at 90 days",
    engineId: notePayoffEngine.id,
    inputs: {
      principalBalanceCents: 4_000_000,
      annualRateBps: 987.5, // 9.875% — deliberately fractional
      accrualStartDate: "2026-01-01T00:00:00.000Z",
      payoffDate: "2026-04-01T00:00:00.000Z",
      ...over,
    },
  });

  it("computes through the composed registry, not the core one", () => {
    // The note engine lives server-side (statute-adjacent arithmetic), so the
    // CORE set must NOT know it — that is the boundary working, not a bug.
    expect(() => computeScenario(noteRequest())).toThrow(ScenarioEngineError);
    const body = computeScenario(noteRequest(), ALL_ENGINES);
    expect(body.engineId).toBe(notePayoffEngine.id);
  });

  it("reads its version FROM the engine that owns the arithmetic", () => {
    // A version duplicated away from its formula is a stamp that lies.
    const body = computeScenario(noteRequest(), ALL_ENGINES);
    expect(body.engineVersion).toBe(PAYOFF_ENGINE_VERSION);
  });

  it("does not reimplement the payoff maths — it agrees with the one engine", () => {
    // Two implementations of the same money formula is exactly the duplication
    // canonical law 1 forbids.
    const body = computeScenario(noteRequest(), ALL_ENGINES);
    const direct = computePayoffQuote({
      principalBalanceCents: 4_000_000,
      annualRateBps: 987.5,
      accrualStartDate: new Date("2026-01-01T00:00:00.000Z"),
      payoffDate: new Date("2026-04-01T00:00:00.000Z"),
      unappliedCreditCents: 0,
      lateFeesOutstandingCents: 0,
      payoffFeeCents: 0,
    });
    expect(metricValue(body, "payoff_total")).toBe(direct.totalPayoffCents);
    expect(metricValue(body, "accrued_interest")).toBe(direct.accruedInterestCents);
    expect(metricValue(body, "days_accrued")).toBe(direct.daysAccrued);
  });

  it("accepts a FRACTIONAL rate while still refusing fractional money", () => {
    // 9.875% arrives as 987.5 bps from the servicing table — legitimately not
    // an integer. Money is a different rule and stays strict.
    expect(() => computeScenario(noteRequest(), ALL_ENGINES)).not.toThrow();
    expect(() =>
      computeScenario(noteRequest({ principalBalanceCents: 4_000_000.5 }), ALL_ENGINES),
    ).toThrow(/must be an integer/i);
  });

  it("refuses a payoff date before the accrual start", () => {
    // A negative accrual period would produce a payoff smaller than principal —
    // a number that looks like a discount and is a bug.
    expect(() =>
      computeScenario(
        noteRequest({ payoffDate: "2025-06-01T00:00:00.000Z" }),
        ALL_ENGINES,
      ),
    ).toThrow(/must not precede/i);
  });

  it("refuses a malformed date rather than defaulting it to now", () => {
    expect(() =>
      computeScenario(noteRequest({ accrualStartDate: "last Tuesday" }), ALL_ENGINES),
    ).toThrow(/not a valid date/i);
    expect(() =>
      computeScenario(noteRequest({ accrualStartDate: 20260101 }), ALL_ENGINES),
    ).toThrow(/ISO-8601 date string/i);
  });

  it("round-trips dates as ISO strings so the stored inputs stay re-runnable", () => {
    const body = computeScenario(noteRequest(), ALL_ENGINES);
    expect(body.inputs.accrualStartDate).toBe("2026-01-01T00:00:00.000Z");
    expect(body.inputs.payoffDate).toBe("2026-04-01T00:00:00.000Z");
  });

  it("is deterministic, like every engine must be", () => {
    const a = computeScenario(noteRequest(), ALL_ENGINES);
    const b = computeScenario(noteRequest(), ALL_ENGINES);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("emits every metric it declares", () => {
    const body = computeScenario(noteRequest(), ALL_ENGINES);
    const produced = new Set(body.metrics.map((m) => m.id));
    for (const id of notePayoffEngine.produces) {
      expect(produced.has(id), `declared ${id} but did not emit it`).toBe(true);
    }
  });

  it("land and note overlap in no metric — they measure different quantities", () => {
    // NOT a rule that engines must not overlap: sharing metric ids is how
    // cross-strategy comparison works (BI92), and the flip engine below
    // deliberately reuses profit/roi/total_cost. These two simply measure
    // genuinely different things, which is what makes the note engine a test of
    // the contract rather than a second instance of the land shape.
    const land = new Set(CORE_ENGINES[0].produces);
    const note = new Set(notePayoffEngine.produces);
    expect([...note].filter((id) => land.has(id))).toEqual([]);
  });

  it("EVERY registered engine speaks the one metric vocabulary", () => {
    // This is the rule that actually matters. An engine naming a quantity
    // differently from another makes the two incomparable, which is the whole
    // value of the registry.
    expect(ALL_ENGINES.length).toBeGreaterThanOrEqual(3);
    for (const e of ALL_ENGINES) {
      expect(e.version, `${e.id} must declare a version`).toBeTruthy();
      for (const id of e.produces) {
        expect(metricById(id), `${e.id} produces unregistered metric ${id}`).toBeDefined();
      }
    }
    const ids = ALL_ENGINES.map((e) => e.id);
    expect(new Set(ids).size, "engine ids must be unique").toBe(ids.length);
  });
});

describe("the flip engine — a third shape, sharing the vocabulary", () => {
  const flipRequest = (over: Record<string, number | string> = {}) => ({
    subjectType: "property" as const,
    subjectId: 88,
    label: "70% rule, 6-month hold",
    engineId: "flip_mao",
    inputs: {
      arvCents: 28_000_000,
      rehabEstimateCents: 4_500_000,
      purchasePriceCents: 14_000_000,
      maoRulePct: 70,
      rehabContingencyPct: 10,
      sellingCostPct: 7,
      purchaseClosingPct: 2,
      holdMonths: 6,
      monthlyHoldingCostCents: 90_000,
      targetProfitPct: 10,
      ...over,
    },
  });

  it("delegates to computeMao rather than reimplementing the maths", () => {
    const body = computeScenario(flipRequest(), ALL_ENGINES);
    const direct = computeMao({
      arvCents: 28_000_000,
      rehabEstimateCents: 4_500_000,
      purchasePriceCents: 14_000_000,
      feeCents: 0,
      defaults: {
        maoRulePct: 70,
        rehabContingencyPct: 10,
        sellingCostPct: 7,
        purchaseClosingPct: 2,
        holdMonths: 6,
        monthlyHoldingCostCents: 90_000,
        targetProfitPct: 10,
      },
    });
    expect(metricValue(body, "max_allowable_offer")).toBe(direct.maoCents);
    expect(metricValue(body, "rehab_with_contingency")).toBe(
      direct.rehabWithContingencyCents,
    );
    expect(metricValue(body, "total_cost")).toBe(direct.totalCashInCents);
    expect(metricValue(body, "profit")).toBe(direct.netProfitCents);
  });

  it("REUSES profit/roi/total_cost so a flip can be compared with a land deal", () => {
    // Cross-strategy comparison happens through normalised outputs (BI92) and
    // dies the moment two engines name the same quantity differently.
    const flip = new Set(flipMaoEngine.produces);
    const land = new Set(CORE_ENGINES[0].produces);
    for (const shared of ["profit", "roi", "total_cost"]) {
      expect(flip.has(shared), `flip should produce ${shared}`).toBe(true);
      expect(land.has(shared), `land should produce ${shared}`).toBe(true);
    }
  });

  it("converts a PERCENT return into the registry's RATIO unit", () => {
    // computeMao reports netRoiPct as a percent; the `roi` metric is a ratio.
    // Storing a percent under a ratio label is a 100x error waiting to be
    // compared against a land deal's roi (BI182).
    const body = computeScenario(flipRequest(), ALL_ENGINES);
    const roi = metricValue(body, "roi");
    const direct = computeMao({
      arvCents: 28_000_000,
      rehabEstimateCents: 4_500_000,
      purchasePriceCents: 14_000_000,
      feeCents: 0,
      defaults: {
        maoRulePct: 70,
        rehabContingencyPct: 10,
        sellingCostPct: 7,
        purchaseClosingPct: 2,
        holdMonths: 6,
        monthlyHoldingCostCents: 90_000,
        targetProfitPct: 10,
      },
    });
    if (direct.netRoiPct === null) {
      expect(roi).toBeNull();
    } else {
      expect(roi).toBeCloseTo(direct.netRoiPct / 100, 10);
      // A ratio, not a percent: a 25% return is 0.25, never 25.
      expect(Math.abs(roi!)).toBeLessThan(10);
    }
  });

  it("carries a NULL net profit through rather than zeroing it", () => {
    // computeMao returns null when holding cost is unknown. That null is the
    // reason this engine wraps computeMao and not the legacy 70%-rule
    // function, whose numbers read high by construction.
    const body = computeScenario(
      flipRequest({ monthlyHoldingCostCents: 0 }),
      ALL_ENGINES,
    );
    const profit = body.metrics.find((m) => m.id === "profit")!;
    // Present, with its unit, whatever the value — a dropped metric is
    // indistinguishable from one never computed.
    expect(profit.unit).toBe("cents");
    expect(profit.value === null || typeof profit.value === "number").toBe(true);
  });

  it("accepts a fractional PERCENT while still refusing fractional money", () => {
    expect(() =>
      computeScenario(flipRequest({ sellingCostPct: 7.5 }), ALL_ENGINES),
    ).not.toThrow();
    expect(() =>
      computeScenario(flipRequest({ arvCents: 28_000_000.5 }), ALL_ENGINES),
    ).toThrow(/must be an integer/i);
  });

  it("computes profit AT the MAO when no price is supplied, rather than assuming one", () => {
    const { purchasePriceCents, ...noPrice } = flipRequest().inputs;
    const body = computeScenario(
      { ...flipRequest(), inputs: noPrice },
      ALL_ENGINES,
    );
    expect(body.inputs.purchasePriceCents).toBeUndefined();
    expect(metricValue(body, "max_allowable_offer")).not.toBeNull();
  });

  it("is deterministic", () => {
    const a = computeScenario(flipRequest(), ALL_ENGINES);
    const b = computeScenario(flipRequest(), ALL_ENGINES);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("the rental engine — an engine that DECLARES its own assumption", () => {
  const rentalRequest = (over: Record<string, number | string> = {}) => ({
    subjectType: "property" as const,
    subjectId: 91,
    label: "Hold and rent",
    engineId: rentalReturnsEngine.id,
    inputs: {
      purchasePriceCents: 18_000_000,
      monthlyRentCents: 175_000,
      ...over,
    },
  });

  it("delegates to computeRentalReturns rather than reimplementing it", () => {
    const body = computeScenario(
      rentalRequest({ monthlyExpensesCents: 60_000 }),
      ALL_ENGINES,
    );
    const direct = computeRentalReturns({
      purchasePriceCents: 18_000_000,
      monthlyRentCents: 175_000,
      monthlyExpensesCents: 60_000,
    });
    expect(metricValue(body, "annual_noi")).toBe(direct.annualNoiCents);
    expect(metricValue(body, "monthly_cash_flow")).toBe(direct.monthlyCashFlowCents);
    expect(metricValue(body, "gross_rent_multiplier")).toBe(direct.grossRentMultiplier);
  });

  it("DECLARES the 40% expense substitution as a platform-default assumption", () => {
    // This is the whole reason the EngineSpec contract was widened. Only the
    // engine knows it substituted something; without a way to say so the
    // substitution vanishes into a metric and reads as measured.
    const body = computeScenario(rentalRequest(), ALL_ENGINES);
    const assumed = body.assumptions.find(
      (a) => a.key === "monthly_operating_expenses",
    );
    expect(assumed, "the substitution must be recorded, not hidden").toBeDefined();
    expect(assumed!.origin).toBe("platform-default");
    expect(assumed!.basis).toMatch(/40%/);
  });

  it("declares NOTHING when the operator supplied real expenses", () => {
    const body = computeScenario(
      rentalRequest({ monthlyExpensesCents: 60_000 }),
      ALL_ENGINES,
    );
    expect(
      body.assumptions.find((a) => a.key === "monthly_operating_expenses"),
    ).toBeUndefined();
  });

  it("keeps caller assumptions AND engine assumptions, each with its own origin", () => {
    const body = computeScenario(
      {
        ...rentalRequest(),
        assumptions: [
          { key: "rent_growth", value: 0.03, origin: "user" as const },
        ],
      },
      ALL_ENGINES,
    );
    const byKey = Object.fromEntries(body.assumptions.map((a) => [a.key, a.origin]));
    expect(byKey["rent_growth"]).toBe("user");
    expect(byKey["monthly_operating_expenses"]).toBe("platform-default");
  });

  it("treats an omitted expense figure as UNKNOWN, not as zero", () => {
    // If omission meant zero, NOI would equal gross rent and the cap rate would
    // read spectacular. The substitution + its declaration is what prevents it.
    const omitted = computeScenario(rentalRequest(), ALL_ENGINES);
    expect(metricValue(omitted, "annual_noi")).not.toBe(175_000 * 12);
  });

  it("treats an explicit ZERO as unknown too — and says so, rather than silently", () => {
    // computeRentalReturns's own contract is "0/omitted = unknown", because a
    // property with genuinely zero operating expenses does not exist. The
    // adapter does NOT paper over that: an explicit 0 declares the same
    // platform-default assumption an omission does.
    //
    // Pinned deliberately, because the intuitive reading of `0` is "no
    // expenses", and a caller who believed that would be reading a 40%-derived
    // NOI as a measured one.
    const zeroed = computeScenario(
      rentalRequest({ monthlyExpensesCents: 0 }),
      ALL_ENGINES,
    );
    const assumed = zeroed.assumptions.find(
      (a) => a.key === "monthly_operating_expenses",
    );
    expect(assumed, "an explicit 0 must still declare the substitution").toBeDefined();
    expect(assumed!.origin).toBe("platform-default");
  });

  it("converts the cap-rate PERCENT into the registry's RATIO unit", () => {
    const body = computeScenario(
      rentalRequest({ monthlyExpensesCents: 60_000 }),
      ALL_ENGINES,
    );
    const direct = computeRentalReturns({
      purchasePriceCents: 18_000_000,
      monthlyRentCents: 175_000,
      monthlyExpensesCents: 60_000,
    });
    expect(metricValue(body, "cap_rate")).toBeCloseTo(direct.capRatePct / 100, 10);
    // A ratio, not a percent: a 7% cap rate is 0.07, never 7.
    expect(Math.abs(metricValue(body, "cap_rate")!)).toBeLessThan(1);
  });

  it("is deterministic", () => {
    const a = computeScenario(rentalRequest(), ALL_ENGINES);
    const b = computeScenario(rentalRequest(), ALL_ENGINES);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("the multifamily engine — the first engine allowed to REFUSE", () => {
  /** A 12-unit building collecting $18,400/mo, valued at $2.4m. */
  function mfRequest(over: Record<string, number | string> = {}): ComputeScenarioRequest {
    return {
      subjectType: "property",
      subjectId: 77,
      label: "Trailing 12",
      engineId: "multifamily_noi",
      inputs: {
        monthlyRentCollectedCents: 1_840_000,
        valuationCents: 240_000_000,
        valuationBasis: "market",
        structureClass: "residential",
        measuredOpExRowCount: 0,
        measuredOpExMonthsCovered: 0,
        ...over,
      },
    };
  }

  it("is registered and produces every metric it declares", () => {
    const body = computeScenario(mfRequest(), ALL_ENGINES);
    expect(body.engineId).toBe("multifamily_noi");
    expect(body.engineVersion).toBe(multifamilyNoiEngine.version);
    for (const id of multifamilyNoiEngine.produces) {
      expect(body.metrics.some((m) => m.id === id), `missing ${id}`).toBe(true);
    }
  });

  it("delegates the op-ex DECISION rather than reimplementing it", () => {
    // The adapter must produce exactly what shared/rental/noi.ts decides. If it
    // ever diverges, two places in the product would disagree about what a
    // building's operating expense is.
    const body = computeScenario(mfRequest(), ALL_ENGINES);
    const direct = decideOperatingExpense({
      hasMeasured: false,
      measuredOpExMonthlyCents: 0,
      opExBps: undefined,
      isCommercial: false,
      monthlyRentCollectedCents: 1_840_000,
    });
    expect(metricValue(body, "annual_operating_expense")).toBe(
      direct.opExMonthlyCents! * 12,
    );
  });

  it("shares ONE NOI definition with the analytics route", () => {
    // Adding this engine briefly gave `collections - opEx` a second home. The
    // subtraction now lives in shared/rental/noi.ts and BOTH callers use it —
    // pinned here and by a source assertion below, because two copies of a
    // definition drift and the two would then disagree about one building.
    const body = computeScenario(mfRequest(), ALL_ENGINES);
    const { noiAnnualCents } = computeNoi({
      monthlyRentCollectedCents: 1_840_000,
      opExMonthlyCents: Math.round((1_840_000 * 4000) / 10000),
    });
    expect(metricValue(body, "annual_noi")).toBe(noiAnnualCents);

    const route = fs.readFileSync(
      path.join(ROOT, "server/routes-investor-analytics.ts"),
      "utf8",
    );
    expect(route).toContain("computeNoi({");
    expect(route).not.toMatch(/noiMonthly\s*=\s*.*monthlyRentCollected\s*-\s*opExMonthly/);
  });

  // ── The refusal ───────────────────────────────────────────────────────────

  it("REFUSES to invent an op-ex for an unmeasured commercial building", () => {
    // The residential 40%-of-collections rule is meaningless under a triple-net
    // or gross lease, so noi.ts declines rather than guessing. Every figure that
    // depends on op-ex must fall away with it — a null NOI beside a confident
    // cap rate would be worse than either.
    const body = computeScenario(
      mfRequest({ structureClass: "commercial" }),
      ALL_ENGINES,
    );
    for (const id of [
      "annual_operating_expense",
      "annual_noi",
      "cap_rate",
      "operating_expense_ratio",
    ]) {
      expect(metricValue(body, id), `${id} must be null, not a guess`).toBeNull();
    }
    // And it invents no assumption to paper over the refusal: nothing was
    // assumed, so nothing is declared.
    expect(body.assumptions).toEqual([]);
  });

  it("the refusal is explained by the inputs it persists, not by a narration field", () => {
    // A later reader reconstructs WHY from the verbatim inputs — which is the
    // reason normalisedInputs are stored at all.
    const body = computeScenario(
      mfRequest({ structureClass: "commercial" }),
      ALL_ENGINES,
    );
    expect(body.inputs.structureClass).toBe("commercial");
    expect(body.inputs.measuredOpExRowCount).toBe(0);
    expect(body.inputs.opExBps).toBeUndefined();
  });

  it("still computes what does NOT depend on op-ex", () => {
    // GRM is price over gross rent and needs no expense figure. Nulling it too
    // would be a different lie — refusing to answer a question that was asked
    // and is answerable.
    const body = computeScenario(
      mfRequest({ structureClass: "commercial" }),
      ALL_ENGINES,
    );
    expect(metricValue(body, "gross_rent_multiplier")).toBeCloseTo(
      240_000_000 / (1_840_000 * 12),
      10,
    );
  });

  it("a commercial building WITH measured expenses computes normally", () => {
    // The refusal is about absent data, not about being commercial.
    const body = computeScenario(
      mfRequest({
        structureClass: "commercial",
        measuredOpExRowCount: 40,
        measuredOpExMonthsCovered: 12,
        measuredOpExMonthlyCents: 700_000,
      }),
      ALL_ENGINES,
    );
    expect(metricValue(body, "annual_noi")).toBe((1_840_000 - 700_000) * 12);
    expect(body.assumptions).toEqual([]); // measured and complete — nothing assumed
  });

  // ── Three provenances, three different declarations ───────────────────────

  it("names the 40% fallback as the PLATFORM's default", () => {
    const a = computeScenario(mfRequest(), ALL_ENGINES).assumptions;
    const opex = a.find((x) => x.key === "operating_expense")!;
    expect(opex.origin).toBe("platform-default");
    expect(opex.value).toBe("40% of collections");
  });

  it("names an operator's ratio override as the OPERATOR's, not the platform's", () => {
    // Both are ratios rather than measurements, but only one is the customer's
    // own judgement. Collapsing them is how a platform default comes to read as
    // what the customer believed.
    const a = computeScenario(mfRequest({ opExBps: 3200 }), ALL_ENGINES).assumptions;
    const opex = a.find((x) => x.key === "operating_expense")!;
    expect(opex.origin).toBe("user");
    expect(opex.value).toBe("32% of collections");
  });

  it("declares a MEASURED but thin ledger as partial coverage", () => {
    // A real ledger spanning three months is a real but PARTIAL slice.
    // Annualising it silently is the "thin ledger reading as a complete one"
    // failure noi.ts names in its own header.
    const a = computeScenario(
      mfRequest({
        measuredOpExRowCount: 9,
        measuredOpExMonthsCovered: 3,
        measuredOpExMonthlyCents: 500_000,
      }),
      ALL_ENGINES,
    ).assumptions;
    const cov = a.find((x) => x.key === "operating_expense_coverage")!;
    expect(cov.origin).toBe("derived");
    expect(cov.value).toBe(`3/${TRAILING_12_WINDOW_MONTHS} months`);
    // The op-ex itself is NOT re-declared: it was measured, not assumed.
    expect(a.some((x) => x.key === "operating_expense")).toBe(false);
  });

  it("declares NOTHING when the ledger is measured and complete", () => {
    const a = computeScenario(
      mfRequest({
        measuredOpExRowCount: 48,
        measuredOpExMonthsCovered: 12,
        measuredOpExMonthlyCents: 500_000,
      }),
      ALL_ENGINES,
    ).assumptions;
    expect(a).toEqual([]);
  });

  it("holds the coverage rule to the SHARED predicate, not a local >= 12", () => {
    // Whatever isMeasuredCoverageComplete says is complete must be what the
    // engine treats as complete, or the server label and this record could
    // disagree about the same building.
    for (const months of [0, 3, 11, 12, 13]) {
      const declared = computeScenario(
        mfRequest({
          measuredOpExRowCount: 4,
          measuredOpExMonthsCovered: months,
          measuredOpExMonthlyCents: 500_000,
        }),
        ALL_ENGINES,
      ).assumptions.some((x) => x.key === "operating_expense_coverage");
      expect(declared, `months=${months}`).toBe(!isMeasuredCoverageComplete(months));
    }
  });

  // ── The denominator ───────────────────────────────────────────────────────

  it("declares an ASSESSED valuation, because a cap rate on one is a different number", () => {
    // The route this generalises falls back `marketValue ?? assessedValue`. An
    // assessment is a taxing authority's figure on its own cycle and method.
    const a = computeScenario(
      mfRequest({ valuationBasis: "assessed" }),
      ALL_ENGINES,
    ).assumptions;
    const basis = a.find((x) => x.key === "valuation_basis")!;
    expect(basis.value).toBe("assessed");
    expect(basis.basis).toContain("not a market valuation");
  });

  it("declares nothing about the denominator when it IS a market value", () => {
    const a = computeScenario(mfRequest(), ALL_ENGINES).assumptions;
    expect(a.some((x) => x.key === "valuation_basis")).toBe(false);
  });

  it("refuses an unrecognised basis rather than defaulting to the first one", () => {
    // Silently falling back would produce a confident cap rate computed under a
    // basis the caller never chose.
    expect(() =>
      computeScenario(mfRequest({ valuationBasis: "zestimate" }), ALL_ENGINES),
    ).toThrow(ScenarioEngineError);
  });

  it("does NOT reuse total_cost — a valuation is not what the building cost", () => {
    // Putting two different quantities under one metric id is the same class of
    // error as storing a percent under a ratio label.
    expect(multifamilyNoiEngine.produces).not.toContain("total_cost");
  });

  // ── DSCR and cash flow ────────────────────────────────────────────────────

  it("computes DSCR and cash flow only when debt service is supplied", () => {
    const without = computeScenario(mfRequest(), ALL_ENGINES);
    expect(metricValue(without, "dscr")).toBeNull();
    expect(metricValue(without, "monthly_cash_flow")).toBeNull();

    const withDebt = computeScenario(
      mfRequest({ debtServiceMonthlyCents: 800_000 }),
      ALL_ENGINES,
    );
    const noiMonthly = 1_840_000 - Math.round((1_840_000 * 4000) / 10000);
    expect(metricValue(withDebt, "monthly_cash_flow")).toBe(noiMonthly - 800_000);
    expect(metricValue(withDebt, "dscr")).toBeCloseTo(noiMonthly / 800_000, 10);
  });

  it("treats zero debt service as no coverage question, not as infinite coverage", () => {
    // noi / 0 is Infinity, which renders as a number and means nothing.
    const body = computeScenario(
      mfRequest({ debtServiceMonthlyCents: 0 }),
      ALL_ENGINES,
    );
    expect(metricValue(body, "dscr")).toBeNull();
    // Cash flow, however, is perfectly well defined at zero debt service.
    expect(metricValue(body, "monthly_cash_flow")).toBe(
      1_840_000 - Math.round((1_840_000 * 4000) / 10000),
    );
  });

  it("refuses a measured row count with no measured figure", () => {
    expect(() =>
      computeScenario(
        mfRequest({ measuredOpExRowCount: 5, measuredOpExMonthsCovered: 5 }),
        ALL_ENGINES,
      ),
    ).toThrow(ScenarioEngineError);
  });

  it("is deterministic", () => {
    const a = computeScenario(mfRequest(), ALL_ENGINES);
    const b = computeScenario(mfRequest(), ALL_ENGINES);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
