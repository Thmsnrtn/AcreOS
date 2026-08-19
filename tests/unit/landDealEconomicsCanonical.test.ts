/**
 * Land deal economics has ONE implementation, and its assumptions are attributed.
 *
 * THE DEFECT
 * ──────────
 * `computeLandDeal` (`shared/calculators/landDeal.ts`) is a registered scenario
 * engine — `land_deal`, in `CORE_ENGINES`, producing total_cost / net_proceeds /
 * profit / roi / annualized_return / irr / breakeven_sale. It had **zero
 * production callers**.
 *
 * Meanwhile `buildCashFlipScenario` in `blindOfferCalculator.ts` computed the
 * same quantities independently, was live, and was what the customer saw at
 * `POST /api/data-intel/blind-offer`. Two implementations of one money formula
 * is the duplication canonical law 1 forbids — and the canonical one was the
 * unreached one.
 *
 * Its inputs were four constants compiled into the function: carry as
 * `acquisition*0.02 + salePrice*0.01`, disposition as `salePrice*0.08`, a
 * 45-day hold. Fix-and-flip reads every equivalent from
 * `underwritingDefaults.flip` and stamps each `org_rule` or `platform_default`;
 * `underwritingDefaults` had no land section at all, so the wedge vertical's
 * numbers reached the customer unattributed.
 *
 * WHAT IS ASSERTED, AND WHY IN THIS SHAPE
 * ───────────────────────────────────────
 * Three things, and the middle one is the reason this file is trustworthy:
 *
 * 1. The two figures that CHANGED changed in the conservative direction, and
 *    are asserted against hand-computed values rather than against the code.
 * 2. Everything else did NOT change: the platform defaults reproduce the old
 *    hardcodes exactly. This is asserted by computing the OLD formula inline
 *    here and requiring agreement — so a future edit to the defaults that
 *    silently moves a customer's profit fails, and the claim "adopting this
 *    moved no numbers" is checkable rather than asserted in a comment.
 * 3. Provenance is real: an org rule reads as the org's, an absent one as ours.
 */

import { describe, it, expect } from "vitest";
import { computeLandDeal } from "../../shared/calculators/landDeal";
import {
  resolveLandDefaults,
  PLATFORM_LAND_DEFAULTS,
} from "../../server/services/landDealDefaults";

/** The pre-2026-08-19 inline model, kept here as the thing to agree with. */
function legacyCashFlip(acquisition: number, medianPerAcre: number, acres: number) {
  const salePrice = medianPerAcre * acres;
  const holdingCosts = acquisition * 0.02 + salePrice * 0.01;
  const dispositionCosts = salePrice * 0.08;
  const netProfit = salePrice - acquisition - holdingCosts - dispositionCosts;
  return { salePrice, holdingCosts, dispositionCosts, netProfit };
}

/** The current model, expressed exactly as `buildCashFlipScenario` expresses it. */
function currentCashFlip(
  acquisition: number,
  medianPerAcre: number,
  acres: number,
  stored?: Partial<typeof PLATFORM_LAND_DEFAULTS>,
) {
  const { values } = resolveLandDefaults(stored);
  const salePrice = medianPerAcre * acres;
  const toCents = (d: number) => Math.round(d * 100);
  const out = computeLandDeal({
    purchaseCents: toCents(acquisition),
    closingAtBuyCents: toCents(acquisition * (values.closingAtBuyPct / 100)),
    holdingPerMonthCents: toCents(salePrice * (values.monthlyHoldingPctOfSale / 100)),
    holdMonths: values.holdMonths,
    marketingCents: 0,
    salePriceCents: toCents(salePrice),
    closingAtSaleCents: toCents(salePrice * (values.dispositionCostPct / 100)),
  });
  return { salePrice, out, values };
}

const CASES = [
  { acquisition: 2_500, medianPerAcre: 1_200, acres: 10 },
  { acquisition: 18_000, medianPerAcre: 3_500, acres: 20 },
  { acquisition: 500, medianPerAcre: 900, acres: 1 },
];

describe("the platform defaults reproduce the old economics exactly", () => {
  it("vacuity: the cases produce distinct, non-trivial numbers", () => {
    const profits = CASES.map((c) => legacyCashFlip(c.acquisition, c.medianPerAcre, c.acres).netProfit);
    expect(new Set(profits.map(Math.round)).size).toBe(CASES.length);
    for (const p of profits) expect(Math.abs(p)).toBeGreaterThan(100);
  });

  it("net profit is unchanged — adopting the engine moved no customer's number", () => {
    // The load-bearing case. The defaults were chosen to preserve the old
    // figures; if someone later "tidies" one, a real profit moves and this
    // fails with the two numbers side by side.
    for (const c of CASES) {
      const legacy = legacyCashFlip(c.acquisition, c.medianPerAcre, c.acres);
      const now = currentCashFlip(c.acquisition, c.medianPerAcre, c.acres);
      expect(
        Math.round(now.out.profitCents / 100),
        `net profit moved for acquisition ${c.acquisition}`,
      ).toBe(Math.round(legacy.netProfit));
    }
  });

  it("the carry and disposition lines are unchanged too", () => {
    for (const c of CASES) {
      const legacy = legacyCashFlip(c.acquisition, c.medianPerAcre, c.acres);
      const { salePrice, values } = currentCashFlip(c.acquisition, c.medianPerAcre, c.acres);
      const carry =
        salePrice * (values.monthlyHoldingPctOfSale / 100) * Math.floor(values.holdMonths) +
        c.acquisition * (values.closingAtBuyPct / 100);
      expect(Math.round(carry)).toBe(Math.round(legacy.holdingCosts));
      expect(Math.round(salePrice * (values.dispositionCostPct / 100)))
        .toBe(Math.round(legacy.dispositionCosts));
    }
  });
});

describe("the two figures that DID change, changed conservatively", () => {
  it("ROI is on total cost in, not on the purchase price alone", () => {
    const c = CASES[1];
    const legacy = legacyCashFlip(c.acquisition, c.medianPerAcre, c.acres);
    const legacyRoiPct = (legacy.netProfit / c.acquisition) * 100;

    const { out } = currentCashFlip(c.acquisition, c.medianPerAcre, c.acres);
    expect(out.roi).not.toBeNull();
    const nowRoiPct = out.roi! * 100;

    // Same profit, larger denominator ⇒ strictly smaller ROI. The old number
    // read HIGH by construction, which is the same flaw the flip adapter's
    // header calls out about the legacy calculateFlipAnalysis.
    expect(nowRoiPct).toBeLessThan(legacyRoiPct);

    // And it is the right number, computed here rather than read off the code.
    const totalCostIn =
      c.acquisition +
      c.acquisition * 0.02 +
      legacy.salePrice * 0.01 +
      0;
    expect(nowRoiPct).toBeCloseTo((legacy.netProfit / totalCostIn) * 100, 1);
  });

  it("ROI on no cost basis is NULL, not zero", () => {
    // `roi = acquisition > 0 ? ... : 0` presented an undefined return as a
    // measured break-even. Zero is a finding; this is the absence of one.
    const { out } = currentCashFlip(0, 0, 0);
    expect(out.roi).toBeNull();
    expect(out.annualizedReturn).toBeNull();
  });
});

describe("every cost rule says whose it is", () => {
  it("an absent field is ours, a stored one is theirs", () => {
    const r = resolveLandDefaults({ dispositionCostPct: 6 });
    expect(r.values.dispositionCostPct).toBe(6);
    expect(r.sources.dispositionCostPct).toBe("org_rule");
    expect(r.sources.closingAtBuyPct).toBe("platform_default");
    expect(r.values.closingAtBuyPct).toBe(PLATFORM_LAND_DEFAULTS.closingAtBuyPct);
    expect(r.isCustomised).toBe(true);
  });

  it("nothing stored means nothing claimed as theirs", () => {
    for (const stored of [undefined, null, {}]) {
      const r = resolveLandDefaults(stored as never);
      expect(r.isCustomised).toBe(false);
      expect(Object.values(r.sources).every((s) => s === "platform_default")).toBe(true);
    }
  });

  it("a non-finite stored value is treated as absent, not adopted", () => {
    // A NaN or a string that leaked through the jsonb column must not become
    // "the operator's rule" — it would badge as theirs and compute as garbage.
    const r = resolveLandDefaults({ holdMonths: NaN, closingAtBuyPct: "3" as never });
    expect(r.sources.holdMonths).toBe("platform_default");
    expect(r.sources.closingAtBuyPct).toBe("platform_default");
    expect(r.values.holdMonths).toBe(PLATFORM_LAND_DEFAULTS.holdMonths);
    expect(r.isCustomised).toBe(false);
  });

  it("an org rule actually changes the economics", () => {
    // Otherwise provenance would be decoration: a badge saying "your rule"
    // over a number that governs nothing.
    const c = CASES[0];
    const base = currentCashFlip(c.acquisition, c.medianPerAcre, c.acres);
    const cheaper = currentCashFlip(c.acquisition, c.medianPerAcre, c.acres, {
      dispositionCostPct: 4,
    });
    expect(cheaper.out.profitCents).toBeGreaterThan(base.out.profitCents);
  });
});
