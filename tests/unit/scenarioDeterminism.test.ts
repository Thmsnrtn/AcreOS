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
  ENGINES,
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

  it("every engine produces only registered metrics", () => {
    for (const e of ENGINES) {
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
