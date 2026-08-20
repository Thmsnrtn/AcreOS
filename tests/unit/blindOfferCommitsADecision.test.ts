/**
 * Land can decide, not only calculate.
 *
 * ── THE GAP ─────────────────────────────────────────────────────────────────
 * `POST /api/data-intel/blind-offer` computed a full report and returned it.
 * Nothing was persisted. Land was the only strategy in AcreOS that could
 * produce a number and never a DECISION: the operator calculated, the report
 * evaporated, and when the offer landed or died there was nothing to attach
 * that outcome to. The fix-and-flip analyzer has written into the canonical
 * loop since it became the first customer surface to do so; this is the land
 * equivalent.
 *
 * ── WHAT THIS FILE PROVES ───────────────────────────────────────────────────
 * The load-bearing claim is not "a row was written". It is that **what gets
 * frozen is what the operator saw**. The wizard's numbers come from
 * `buildCashFlipScenario`; the commit endpoint's come from `recordScenario`
 * running the registered engine. Those are two paths to the same arithmetic,
 * and if they diverge the record of a decision does not match the screen it was
 * made on — which is the one failure a frozen scenario exists to prevent.
 *
 * So the shared mapping (`landDealEngineInputs`) is pinned in both directions,
 * and the engine is run against it to show the metrics agree with the report.
 *
 * The route's own obligations — tenancy, the land-status guard, and refusing to
 * report a decision it did not record — are in
 * `tests/unit/blindOfferCommitRoute.test.ts`. Here the arithmetic contract is
 * what is checked, with no mocks at all, because that is the part that can
 * silently drift.
 */

import { describe, expect, it } from "vitest";
import {
  landDealEngineInputs,
  resolveLandDefaults,
  PLATFORM_LAND_DEFAULTS,
} from "../../server/services/landDealDefaults";
import { computeLandDeal, LAND_DEAL_ENGINE_ID } from "@shared/calculators/landDeal";
import { CORE_ENGINES, computeScenario, engineById } from "@shared/economics/scenario";

const ACQUISITION = 40_000;
const SALE = 100_000;

describe("the commit freezes the same arithmetic the wizard showed", () => {
  it("the shared mapping is what both paths use", () => {
    const { values } = resolveLandDefaults(null);
    const inputs = landDealEngineInputs(ACQUISITION, SALE, values);

    // Spelled out rather than recomputed with the same expression, so a change
    // to the mapping has to be justified here instead of agreeing with itself.
    expect(inputs).toEqual({
      purchaseCents: 4_000_000,
      closingAtBuyCents: 80_000, // 2% of purchase
      holdingPerMonthCents: 50_000, // 0.5% of SALE per month
      holdMonths: 2,
      marketingCents: 0, // dispositionCostPct already covers marketing
      salePriceCents: 10_000_000, // $100,000
      closingAtSaleCents: 800_000, // 8% of sale
    });
  });

  it("the registered engine accepts those inputs and returns the same profit", () => {
    const { values } = resolveLandDefaults(null);
    const inputs = landDealEngineInputs(ACQUISITION, SALE, values);

    const direct = computeLandDeal(inputs);
    const engine = engineById(LAND_DEAL_ENGINE_ID, CORE_ENGINES);
    expect(engine, "the land engine is not registered — the commit cannot run").toBeDefined();

    const scenario = computeScenario(
      {
        subjectType: "property",
        subjectId: 1,
        label: "test",
        engineId: LAND_DEAL_ENGINE_ID,
        inputs: { ...inputs },
        assumptions: [],
      },
      CORE_ENGINES,
    );
    const profit = scenario.metrics.find((m) => m.id === "profit");
    expect(profit, "the engine stopped producing a profit metric").toBeDefined();
    expect(
      profit!.value,
      "the engine and the direct calculator disagree — the frozen scenario would " +
        "not be the one the operator was shown",
    ).toBe(direct.profitCents);
  });

  it("an org rule moves the frozen inputs, and is marked as theirs", () => {
    // The provenance half: a platform default silently reading later as "what
    // the customer believed" is the failure `origin` exists to prevent.
    const resolved = resolveLandDefaults({ closingAtBuyPct: 5 });
    expect(resolved.sources.closingAtBuyPct).toBe("org_rule");
    expect(resolved.sources.dispositionCostPct).toBe("platform_default");

    const inputs = landDealEngineInputs(ACQUISITION, SALE, resolved.values);
    expect(inputs.closingAtBuyCents).toBe(200_000); // 5% of $40,000
    expect(
      inputs.closingAtBuyCents,
      "the org's rule did not reach the frozen inputs",
    ).not.toBe(landDealEngineInputs(ACQUISITION, SALE, PLATFORM_LAND_DEFAULTS).closingAtBuyCents);
  });

  it("marketing stays zero, because disposition already includes it", () => {
    // Regression on a double-count that would understate profit on every land
    // decision ever frozen. `dispositionCostPct` is documented as resale
    // closing AND marketing.
    const { values } = resolveLandDefaults(null);
    expect(landDealEngineInputs(ACQUISITION, SALE, values).marketingCents).toBe(0);
  });

  it("vacuity: the mapping actually depends on both dollar figures", () => {
    // If it ignored one of them, every assertion above would still pass on the
    // single fixture they share.
    const { values } = resolveLandDefaults(null);
    const base = landDealEngineInputs(ACQUISITION, SALE, values);
    const dearerBuy = landDealEngineInputs(ACQUISITION * 2, SALE, values);
    const dearerSale = landDealEngineInputs(ACQUISITION, SALE * 2, values);

    expect(dearerBuy.purchaseCents).toBe(base.purchaseCents * 2);
    expect(dearerBuy.closingAtBuyCents).toBe(base.closingAtBuyCents * 2);
    expect(dearerBuy.salePriceCents).toBe(base.salePriceCents);

    expect(dearerSale.salePriceCents).toBe(base.salePriceCents * 2);
    expect(dearerSale.closingAtSaleCents).toBe(base.closingAtSaleCents * 2);
    expect(dearerSale.holdingPerMonthCents).toBe(base.holdingPerMonthCents * 2);
    expect(dearerSale.purchaseCents).toBe(base.purchaseCents);
  });
});
