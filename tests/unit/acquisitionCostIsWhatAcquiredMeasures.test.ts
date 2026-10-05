/**
 * "Acquired" measures what it asks for (DEFECT-0287).
 *
 * Today asks at "Acquired": "What did it actually cost to acquire? Price plus
 * closing." Until 2026-10-05 the answer was filed as `total_cost`, which the
 * engines compute all-in — rehab, holding, carry included — so a $200,000
 * rental with a $10,000 rehab read as acquired $10,000 under forecast, every
 * time, and calibration learned the operator overestimates cost.
 *
 * Three things must hold, and each is checked against the real objects:
 *   1. the prompt's "Acquired" measure IS `acquisition_cost` (the shared
 *      definition, which OutcomePrompt renders and the evidence gate grades by);
 *   2. every vertical engine whose decision can end in "Acquired" PREDICTS it —
 *      the population is the live registry, with a named exemption list that
 *      cannot rot;
 *   3. what it predicts is price + closing (net of any closing credit), never
 *      the costs that come after — proven on inputs where they differ.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ALL_ENGINES } from "../../server/services/economics/engines";
import { computeScenario, metricById } from "../../shared/economics/scenario";
import { OUTCOME_MEASURES } from "../../shared/outcomes/outcomeMeasures";

const MEASURED_OUTCOME_METRIC_IDS = Object.values(OUTCOME_MEASURES).map((m) => m.metricId);
import { stripComments } from "../helpers/stripComments";

/** Vertical engines whose decision never takes title, so "Acquired" never applies. */
const NEVER_ACQUIRES: Readonly<Record<string, string>> = {
  wholesale_assignment: "a wholesaler assigns the contract and never takes title",
  subdivision_lot_sale: "a price lock on lots the operator already owns",
};

const verticalEngines = ALL_ENGINES.filter((e) => (e.verticals ?? []).length > 0);

describe("the prompt asks for acquisition_cost at Acquired", () => {
  it("the shared definition measures acquisition_cost, a registered cents metric", () => {
    expect(OUTCOME_MEASURES.acquired.metricId).toBe("acquisition_cost");
    expect(metricById("acquisition_cost")?.unit).toBe("cents");
    expect(MEASURED_OUTCOME_METRIC_IDS).toEqual(["acquisition_cost", "profit"]);
    expect(MEASURED_OUTCOME_METRIC_IDS).not.toContain("total_cost");
  });

  it("OutcomePrompt renders the shared definition, not its own copy", () => {
    const src = stripComments(
      fs.readFileSync(path.resolve(__dirname, "../../client/src/components/today/OutcomePrompt.tsx"), "utf8"),
    );
    expect(src).toMatch(/import \{ OUTCOME_MEASURES \} from "@shared\/outcomes\/outcomeMeasures"/);
    expect(src).toMatch(/measures:\s*OUTCOME_MEASURES\.acquired/);
    expect(src).toMatch(/measures:\s*OUTCOME_MEASURES\.sold/);
    // No hand-written metric id may sit beside it.
    expect(src).not.toMatch(/metricId:\s*"/);
  });
});

describe("every engine whose decision can be acquired predicts acquisition_cost", () => {
  it("vacuity: the population is the live registry", () => {
    expect(verticalEngines.length).toBeGreaterThanOrEqual(14);
  });

  it("each one produces it — or is named, with a reason, as never acquiring", () => {
    const missing = verticalEngines
      .filter((e) => !e.produces.includes("acquisition_cost") && !Object.hasOwn(NEVER_ACQUIRES, e.id))
      .map((e) => e.id);
    expect(missing).toEqual([]);
  });

  it("the exemption list cannot rot", () => {
    for (const id of Object.keys(NEVER_ACQUIRES)) {
      const e = ALL_ENGINES.find((x) => x.id === id);
      expect(e, `${id} is no longer registered — remove it`).toBeDefined();
      expect(e!.produces, `${id} now predicts acquisition_cost — remove its exemption`).not.toContain("acquisition_cost");
    }
  });
});

describe("acquisition_cost is price + closing, never the costs that come after", () => {
  const value = (engineId: string, inputs: Record<string, number>, id: string) =>
    computeScenario({ subjectType: "property", subjectId: 1, label: "x", engineId, inputs }, ALL_ENGINES).metrics.find(
      (m) => m.id === id,
    )?.value;

  const CASES: Array<{ engineId: string; inputs: Record<string, number>; acquisition: number; why: string }> = [
    {
      engineId: "rental_acquisition",
      why: "$200,000 + $4,000 closing; the $10,000 rehab comes after",
      inputs: {
        purchasePriceCents: 20_000_000,
        closingCostsCents: 400_000,
        rehabCents: 1_000_000,
        monthlyRentCents: 200_000,
        vacancyPct: 5,
        monthlyFixedExpensesCents: 50_000,
        managementPct: 8,
        reservesPct: 10,
      },
      acquisition: 20_400_000,
    },
    {
      engineId: "land_deal",
      why: "$40,000 + $400 closing; holding and marketing come after",
      inputs: {
        purchaseCents: 4_000_000,
        closingAtBuyCents: 40_000,
        holdingPerMonthCents: 5_000,
        holdMonths: 9,
        marketingCents: 150_000,
        salePriceCents: 6_800_000,
        closingAtSaleCents: 204_000,
      },
      acquisition: 4_040_000,
    },
    {
      engineId: "flip_mao",
      why: "$140,000 + 2% closing ($2,800); rehab and holding come after",
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
      },
      acquisition: 14_280_000,
    },
    {
      engineId: "agent_flip",
      why: "$300,000 + $4,500 closing − $6,300 buy-side credit (3% × 70% kept)",
      inputs: {
        purchasePriceCents: 30_000_000,
        buySideCommissionPct: 3,
        buySideBrokerageSplitPct: 30,
        purchaseClosingCostsCents: 450_000,
        rehabCents: 4_000_000,
        holdMonths: 6,
        monthlyHoldingCostCents: 150_000,
        salePriceCents: 42_500_000,
        listingCommissionPct: 3,
        listingBrokerageSplitPct: 30,
        coopCommissionPct: 2.5,
        saleClosingCostsPct: 1.5,
      },
      acquisition: 29_820_000,
    },
    {
      engineId: "development_proforma",
      why: "the $500,000 land; entitlement, improvements and carry come after",
      inputs: {
        landCostCents: 50_000_000,
        entitlementCostsCents: 10_000_000,
        improvementCostsCents: 60_000_000,
        lotCount: 20,
        averageLotPriceCents: 9_000_000,
        sellingCostPct: 6,
        entitlementMonths: 6,
        developmentMonths: 6,
        selloutMonths: 12,
      },
      acquisition: 50_000_000,
    },
  ];

  for (const c of CASES) {
    it(`${c.engineId}: ${c.why}`, () => {
      expect(value(c.engineId, c.inputs, "acquisition_cost")).toBe(c.acquisition);
      // The point of the metric: it differs from the all-in total wherever
      // something is spent after the purchase.
      expect(value(c.engineId, c.inputs, "total_cost")).toBeGreaterThan(c.acquisition);
    });
  }
});
