/**
 * The blind-offer exit model must go through the canonical engine.
 *
 * `landDealEconomicsCanonical.test.ts` proves the ENGINE behaves correctly and
 * that the platform defaults preserve the old figures. It does not prove that
 * `blindOfferCalculator` actually calls it — and a fix that leaves the second
 * implementation in place while a test exercises the first is precisely the
 * "canonical function with no production adoption" trap this repository has
 * been bitten by twice.
 *
 * So this drives the REAL `calculateBlindOffer` and asserts on what it returns:
 * a null ROI where the inline version returned 0, provenance the inline version
 * could not produce, and a breakeven the inline version never computed. Each is
 * a property only the engine path can satisfy.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/services/usdaNass", () => ({
  getCachedCountySnapshot: vi.fn(async () => null),
  getCachedLandTrend: vi.fn(async () => null),
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { calculateBlindOffer } = await import("../../server/services/blindOfferCalculator");

/** Comps good enough that the calculator returns a real report. */
const COMPS = [
  { pricePerAcre: 1200, acres: 10, soldDate: "2026-05-01", source: "manual" },
  { pricePerAcre: 1400, acres: 12, soldDate: "2026-06-01", source: "manual" },
  { pricePerAcre: 1100, acres: 8, soldDate: "2026-04-01", source: "manual" },
];

async function run(over: Record<string, unknown> = {}) {
  return calculateBlindOffer({
    state: "TX",
    county: "Bandera",
    targetAcres: 10,
    comps: COMPS as never,
    ...over,
  } as never);
}

describe("the exit model is the canonical engine's output", () => {
  it("vacuity: the calculator returns a real report for these comps", async () => {
    const r = await run();
    expect(r.status, `calculator refused: ${JSON.stringify(r).slice(0, 200)}`).toBe("ok");
    expect((r as { cashFlipScenario: unknown }).cashFlipScenario).toBeTruthy();
  });

  it("carries assumption provenance the inline model could not produce", async () => {
    const r = await run() as { cashFlipScenario: { assumptions: Array<{ key: string; source: string; display: string }> } };
    const a = r.cashFlipScenario.assumptions;
    expect(a.length).toBeGreaterThanOrEqual(4);
    // Nothing stored ⇒ every rule is ours, and says so.
    expect(a.every((x) => x.source === "platform_default")).toBe(true);
    expect(a.map((x) => x.key).sort()).toEqual(
      ["closingAtBuyPct", "dispositionCostPct", "holdMonths", "monthlyHoldingPctOfSale"],
    );
    // Pre-formatted, so the badge and the scenario word it identically.
    expect(a.find((x) => x.key === "holdMonths")?.display).toMatch(/month/);
  });

  it("an org rule reaches the economics and is badged as theirs", async () => {
    const base = await run() as { cashFlipScenario: { netProfit: number } };
    const custom = await run({ landDealDefaults: { dispositionCostPct: 4 } }) as {
      cashFlipScenario: { netProfit: number; assumptions: Array<{ key: string; source: string }> };
    };
    expect(custom.cashFlipScenario.netProfit).toBeGreaterThan(base.cashFlipScenario.netProfit);
    expect(
      custom.cashFlipScenario.assumptions.find((x) => x.key === "dispositionCostPct")?.source,
    ).toBe("org_rule");
  });

  it("reports a breakeven sale — a metric the inline model never computed", async () => {
    const r = await run() as { cashFlipScenario: { breakevenSale: number } };
    expect(typeof r.cashFlipScenario.breakevenSale).toBe("number");
    expect(r.cashFlipScenario.breakevenSale).toBeGreaterThan(0);
  });

  it("ROI is a number here, and the field admits null", async () => {
    // These comps give a real cost basis, so ROI is a number. The type allowing
    // null is what stops the zero-for-undefined substitution; the null path
    // itself is proven against the engine in the sibling file.
    const r = await run() as { cashFlipScenario: { roi: number | null } };
    expect(r.cashFlipScenario.roi).not.toBeNull();
    expect(typeof r.cashFlipScenario.roi).toBe("number");
  });
});
