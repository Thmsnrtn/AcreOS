/**
 * §5A guarantee tail-exposure model (P1-14 / B2) — the PURE function only.
 * Nothing is mocked: every case constructs a charge list and reads the result.
 */
import { describe, expect, it } from "vitest";
import { computeGuaranteeExposure, guaranteeFarmScenario, type ExposureCharge } from "../../server/services/refunds/guaranteeExposure";
import { GUARANTEE_REFUND_VELOCITY, GUARANTEE_WINDOW_DAYS } from "../../server/services/refunds/refundConfig";
import { TIERS, TIER_PRICES_CENTS } from "../../shared/billing/tier-pricing";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);

const SCALE_YEAR = TIER_PRICES_CENTS.scale.priceYearlyCents;
const PRO_MONTH = TIER_PRICES_CENTS.pro.priceMonthlyCents;

function charge(over: Partial<ExposureCharge> & { ageDays?: number }): ExposureCharge {
  const { ageDays = 1, ...rest } = over;
  return { amountCents: SCALE_YEAR, chargeCreatedAtMs: NOW - ageDays * DAY, interval: "year", tier: "scale", guaranteeConsumed: false, ...rest };
}

describe("tail membership", () => {
  it("a Scale annual at day 29 is fully in the tail; at day 30 it is zero", () => {
    const in29 = computeGuaranteeExposure([charge({ ageDays: GUARANTEE_WINDOW_DAYS - 1 })], NOW);
    expect(in29.tailCents).toBe(SCALE_YEAR);
    expect(in29.tailCount).toBe(1);
    expect(in29.largestSingleCents).toBe(SCALE_YEAR);
    expect(in29.byIntervalCents).toEqual({ month: 0, year: SCALE_YEAR, unknown: 0 });

    const at30 = computeGuaranteeExposure([charge({ ageDays: GUARANTEE_WINDOW_DAYS })], NOW);
    expect(at30.tailCents).toBe(0);
    expect(at30.tailCount).toBe(0);
  });

  it("a Pro monthly at day 29 is in the tail, an order of magnitude smaller", () => {
    const r = computeGuaranteeExposure([charge({ amountCents: PRO_MONTH, interval: "month", tier: "pro", ageDays: 29 })], NOW);
    expect(r.tailCents).toBe(PRO_MONTH);
    expect(r.byIntervalCents.month).toBe(PRO_MONTH);
    expect(SCALE_YEAR / PRO_MONTH).toBeGreaterThan(10);
  });

  it("consumed and out-of-window charges contribute zero everywhere", () => {
    const r = computeGuaranteeExposure(
      [charge({ guaranteeConsumed: true, ageDays: 2 }), charge({ ageDays: 45 }), charge({ ageDays: 400 })],
      NOW,
    );
    expect(r.tailCents).toBe(0);
    expect(r.tailCount).toBe(0);
    expect(r.largestSingleCents).toBe(0);
    expect(r.burnDown.every((v) => v === 0)).toBe(true);
    expect(r.brakeBound).toEqual({ autoPayableCents: 0, autoPayableCount: 0, queuedRemainderCents: 0 });
  });

  it("malformed rows are excluded without throwing", () => {
    const bad = [
      charge({ amountCents: null }),
      charge({ chargeCreatedAtMs: null }),
      charge({ amountCents: Number.NaN }),
      charge({ chargeCreatedAtMs: Number.POSITIVE_INFINITY }),
      null as unknown as ExposureCharge,
    ];
    let r!: ReturnType<typeof computeGuaranteeExposure>;
    expect(() => {
      r = computeGuaranteeExposure([...bad, charge({ amountCents: PRO_MONTH, interval: null, tier: null, ageDays: 3 })], NOW);
    }).not.toThrow();
    expect(r.tailCents).toBe(PRO_MONTH);
    expect(r.tailCount).toBe(1);
    expect(r.excludedMalformed).toBe(bad.length);
    expect(r.byIntervalCents.unknown).toBe(PRO_MONTH);
    expect(() => computeGuaranteeExposure(undefined as unknown as ExposureCharge[], NOW)).not.toThrow();
  });
});

describe("burn-down", () => {
  const book = [
    charge({ ageDays: 0.5 }),
    charge({ amountCents: PRO_MONTH, interval: "month", tier: "pro", ageDays: 10 }),
    charge({ amountCents: TIER_PRICES_CENTS.starter.priceYearlyCents, tier: "starter", ageDays: 25.25 }),
    charge({ amountCents: PRO_MONTH, interval: "month", tier: "pro", ageDays: 29.9 }),
  ];
  const r = computeGuaranteeExposure(book, NOW);

  it("starts at the tail, never rises, and is zero at day 30", () => {
    expect(r.burnDown).toHaveLength(GUARANTEE_WINDOW_DAYS + 1);
    expect(r.burnDown[0]).toBe(r.tailCents);
    expect(r.burnDown[GUARANTEE_WINDOW_DAYS]).toBe(0);
    for (let d = 1; d < r.burnDown.length; d++) expect(r.burnDown[d]).toBeLessThanOrEqual(r.burnDown[d - 1]);
  });

  it("drops each charge exactly on its 30th day", () => {
    // age 29.9 → gone after 1 day; age 25.25 → gone after 5 (25.25+5 ≥ 30, +4 < 30).
    expect(r.burnDown[0] - r.burnDown[1]).toBe(PRO_MONTH);
    const starterYear = TIER_PRICES_CENTS.starter.priceYearlyCents;
    expect(r.burnDown[4] - r.burnDown[5]).toBe(starterYear);
    // age 10 → gone after 20; age 0.5 → gone after 30 (0.5+29 < 30, 0.5+30 ≥ 30).
    expect(r.burnDown[19] - r.burnDown[20]).toBe(PRO_MONTH);
    expect(r.burnDown[29]).toBe(SCALE_YEAR);
  });
});

describe("brake bound", () => {
  it("twelve annual Scale charges: respects BOTH caps, the rest queues", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => charge({ ageDays: 1 + i * 0.1 }));
    const r = computeGuaranteeExposure(twelve, NOW);
    const byCap = Math.floor(GUARANTEE_REFUND_VELOCITY.maxCents / SCALE_YEAR);
    const expectedCount = Math.min(byCap, GUARANTEE_REFUND_VELOCITY.maxCount);
    expect(r.tailCents).toBe(12 * SCALE_YEAR);
    expect(r.brakeBound.autoPayableCount).toBe(expectedCount);
    expect(r.brakeBound.autoPayableCents).toBe(expectedCount * SCALE_YEAR);
    expect(r.brakeBound.autoPayableCents).toBeLessThanOrEqual(GUARANTEE_REFUND_VELOCITY.maxCents);
    expect(r.brakeBound.autoPayableCount).toBeLessThanOrEqual(GUARANTEE_REFUND_VELOCITY.maxCount);
    expect(r.brakeBound.queuedRemainderCents).toBe(r.tailCents - r.brakeBound.autoPayableCents);
    expect(r.brakeBound.queuedRemainderCents).toBeGreaterThan(0);
  });

  it("the count cap binds on its own when charges are small", () => {
    const many = Array.from({ length: GUARANTEE_REFUND_VELOCITY.maxCount + 5 }, () => charge({ amountCents: PRO_MONTH, interval: "month", ageDays: 2 }));
    const r = computeGuaranteeExposure(many, NOW);
    expect(r.brakeBound.autoPayableCount).toBe(GUARANTEE_REFUND_VELOCITY.maxCount);
    expect(r.brakeBound.queuedRemainderCents).toBe(5 * PRO_MONTH);
  });

  it("three monthlies are fully auto-payable", () => {
    const r = computeGuaranteeExposure(Array.from({ length: 3 }, () => charge({ amountCents: PRO_MONTH, interval: "month", ageDays: 4 })), NOW);
    expect(r.brakeBound.autoPayableCents).toBe(3 * PRO_MONTH);
    expect(r.brakeBound.autoPayableCount).toBe(3);
    expect(r.brakeBound.queuedRemainderCents).toBe(0);
  });
});

describe("farm scenario", () => {
  const rows = guaranteeFarmScenario();

  it("covers every tier × interval with the pricing table's figures", () => {
    expect(rows).toHaveLength(TIERS.length * 2);
    for (const tier of TIERS) {
      const month = rows.find((x) => x.tier === tier && x.interval === "month")!;
      const year = rows.find((x) => x.tier === tier && x.interval === "year")!;
      expect(month.perSignupCents).toBe(TIER_PRICES_CENTS[tier].priceMonthlyCents);
      expect(year.perSignupCents).toBe(TIER_PRICES_CENTS[tier].priceYearlyCents);
      for (const row of [month, year]) {
        expect(row.signupsUnderBrake).toBe(Math.min(Math.floor(GUARANTEE_REFUND_VELOCITY.maxCents / row.perSignupCents), GUARANTEE_REFUND_VELOCITY.maxCount));
        // One more signup than the brake absorbs would exceed a cap.
        const next = row.signupsUnderBrake + 1;
        expect(next > GUARANTEE_REFUND_VELOCITY.maxCount || next * row.perSignupCents > GUARANTEE_REFUND_VELOCITY.maxCents).toBe(true);
      }
    }
  });

  it("is attached to the model result", () => {
    expect(computeGuaranteeExposure([], NOW).farmScenario).toEqual(rows);
  });
});
