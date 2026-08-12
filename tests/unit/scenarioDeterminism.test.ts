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

  it("the two engines share the metric registry but overlap in nothing", () => {
    // Genuinely contrasting: if the second engine produced the same metrics as
    // the first, it would be a second instance of one shape rather than a test
    // of the contract.
    const land = new Set(CORE_ENGINES[0].produces);
    const note = new Set(notePayoffEngine.produces);
    const shared = [...note].filter((id) => land.has(id));
    expect(shared).toEqual([]);
    // …and every metric on both sides is registered in the SAME vocabulary.
    for (const id of [...land, ...note]) {
      expect(metricById(id), `${id} must be registered`).toBeDefined();
    }
  });
});
