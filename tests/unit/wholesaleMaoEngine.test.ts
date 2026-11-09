/**
 * The wholesale MAO engine (`wholesale_mao`) — Leg 1 of the wholesale package.
 *
 * FALSIFYING: on pre-leg main this file fails to import (the engine does not
 * exist), the kit's ownership guard refuses every residential_wholesaler
 * decision, and `wholesale_mao` is not in the registry.
 *
 * Proves:
 *   - the offer is min(seller-side MAO, buyer-side MAO) − target fee, with each
 *     side computed by the SHARED computeMao (no second MAO formula);
 *   - which side bound is recorded, in both directions;
 *   - every input is required (no invented buyer rule);
 *   - the engine is registered properly: in ALL_ENGINES, declaring
 *     residential_wholesaler, and the kit's ownership guard accepts it for that
 *     pack and REFUSES it for any other (the guard is not special-cased);
 *   - it predicts `profit`, which is what makes the decision gradeable.
 */
import { describe, expect, it } from "vitest";
import { computeScenario, engineById, ScenarioEngineError } from "../../shared/economics/scenario";
import { ALL_ENGINES } from "../../server/services/economics/engines";
import { wholesaleMaoEngine } from "../../server/services/economics/engines/wholesaleMao";
import { computeMao } from "../../server/services/flipUnderwriting";
import { previewUnderwriting } from "../../server/services/underwriting/verticalDecision";
import { WHOLESALE_MAO_FIELDS } from "../../shared/economics/fields/wholesaleMao";

const base = {
  arvCents: 30_000_000, // $300,000
  rehabEstimateCents: 4_000_000, // $40,000
  targetFeeCents: 1_000_000, // $10,000
  sellerRulePct: 75,
  sellerContingencyPct: 10,
  buyerRulePct: 70,
  buyerContingencyPct: 10,
};

/** The engine's own breakdown, read off the scenario it produces (no private import). */
function computeWholesaleMao(inputs: Record<string, number>) {
  const body = computeScenario({ subjectType: "property", subjectId: 1, label: "t", engineId: "wholesale_mao", inputs }, ALL_ENGINES);
  const a = (k: string) => body.assumptions.find((x) => x.key === k)?.value;
  return {
    sellerSideMaoCents: a("seller_side_mao") as number,
    buyerSideMaoCents: a("buyer_side_mao") as number,
    bindingSide: a("binding_side") as "seller" | "buyer",
    offerCents: body.metrics.find((m) => m.id === "max_allowable_offer")?.value as number,
  };
}

const metric = (inputs: Record<string, number>, id: string) =>
  computeScenario({ subjectType: "property", subjectId: 1, label: "t", engineId: "wholesale_mao", inputs }, ALL_ENGINES)
    .metrics.find((m) => m.id === id)?.value;

describe("the arithmetic", () => {
  it("offer = min(seller-side, buyer-side) − fee; the buyer binds here", () => {
    // seller: 300k×75% − 44k = 181k; buyer: 300k×70% − 44k = 166k → 166k − 10k
    const r = computeWholesaleMao(base);
    expect(r.sellerSideMaoCents).toBe(18_100_000);
    expect(r.buyerSideMaoCents).toBe(16_600_000);
    expect(r.bindingSide).toBe("buyer");
    expect(r.offerCents).toBe(15_600_000);
    expect(metric(base, "max_allowable_offer")).toBe(15_600_000);
  });

  it("the seller side binds when the operator's own ceiling is lower", () => {
    const r = computeWholesaleMao({ ...base, sellerRulePct: 65 });
    // seller: 195k − 44k = 151k < buyer 166k
    expect(r.bindingSide).toBe("seller");
    expect(r.offerCents).toBe(15_100_000 - 1_000_000);
  });

  it("each side IS computeMao's rule MAO — no second formula", () => {
    for (const [rule, cont] of [[70, 10], [82.5, 0], [60, 25]] as const) {
      const shared = computeMao({
        arvCents: base.arvCents,
        rehabEstimateCents: base.rehabEstimateCents,
        feeCents: 0,
        defaults: { maoRulePct: rule, rehabContingencyPct: cont, sellingCostPct: 9, purchaseClosingPct: 3, holdMonths: 6, monthlyHoldingCostCents: 150_000, targetProfitPct: 15 },
      }).maoCents;
      const r = computeWholesaleMao({ ...base, buyerRulePct: rule, buyerContingencyPct: cont, sellerRulePct: 100, sellerContingencyPct: 0 });
      expect(r.buyerSideMaoCents, `${rule}/${cont}`).toBe(shared);
    }
  });

  it("the fee comes off once — raising it by $1 lowers the offer by $1", () => {
    expect(metric({ ...base, targetFeeCents: base.targetFeeCents + 100 }, "max_allowable_offer")).toBe(15_600_000 - 100);
  });

  it("predicts profit = the target fee, and reports the fee it was given", () => {
    expect(metric(base, "profit")).toBe(1_000_000);
    expect(metric(base, "assignment_fee")).toBe(1_000_000);
  });

  it("records both ceilings and the binding side as derived assumptions", () => {
    const body = computeScenario({ subjectType: "property", subjectId: 1, label: "t", engineId: "wholesale_mao", inputs: base }, ALL_ENGINES);
    const a = Object.fromEntries(body.assumptions.map((x) => [x.key, x]));
    expect(a.seller_side_mao).toMatchObject({ value: 18_100_000, origin: "derived" });
    expect(a.buyer_side_mao).toMatchObject({ value: 16_600_000, origin: "derived" });
    expect(a.binding_side).toMatchObject({ value: "buyer", origin: "derived" });
  });
});

describe("no defaults — every input is required", () => {
  it.each(Object.keys(base))("refuses when %s is missing", (key) => {
    const inputs: Record<string, number> = { ...base };
    delete inputs[key];
    expect(() => computeWholesaleMao(inputs)).toThrow(ScenarioEngineError);
  });

  it("refuses a zero ARV, a 0% rule, a >100% rule and a negative fee", () => {
    for (const bad of [{ arvCents: 0 }, { buyerRulePct: 0 }, { sellerRulePct: 101 }, { targetFeeCents: -1 }]) {
      expect(() => computeWholesaleMao({ ...base, ...bad }), JSON.stringify(bad)).toThrow(ScenarioEngineError);
    }
  });

  it("refuses fractional cents", () => {
    expect(() => computeWholesaleMao({ ...base, targetFeeCents: 100.5 })).toThrow(ScenarioEngineError);
  });
});

describe("registered properly — the kit's ownership guard is not special-cased", () => {
  it("is in ALL_ENGINES, declares only residential_wholesaler, and predicts profit", () => {
    expect(engineById("wholesale_mao", ALL_ENGINES)).toBe(wholesaleMaoEngine);
    expect(wholesaleMaoEngine.verticals).toEqual(["residential_wholesaler"]);
    expect(wholesaleMaoEngine.produces).toContain("profit");
  });

  it("flip_mao still does NOT underwrite residential_wholesaler (the guard was not widened)", () => {
    expect(engineById("flip_mao", ALL_ENGINES)?.verticals).toEqual(["fix_and_flip"]);
  });

  it("previews through the same kit path the recorded decision uses", () => {
    const p = previewUnderwriting("wholesale_mao", base);
    expect(p.metrics.find((m) => m.id === "max_allowable_offer")?.value).toBe(15_600_000);
  });

  it("the form asks for exactly the inputs the engine consumes, none optional", () => {
    expect(WHOLESALE_MAO_FIELDS.map((f) => f.key).sort()).toEqual(Object.keys(base).sort());
    expect(WHOLESALE_MAO_FIELDS.filter((f) => f.optional)).toEqual([]);
  });
});
