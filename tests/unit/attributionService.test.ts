/**
 * T262 — Attribution Service Tests
 * Tests marketing attribution models, touchpoint analysis, and ROI calculation.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

interface Touchpoint {
  channel: string;
  campaignId?: string;
  touchedAt: Date;
  cost?: number; // cents
}

interface Attribution {
  touchpoints: Touchpoint[];
  conversionValue: number; // cents
  convertedAt: Date;
}

function firstTouchAttribution(attribution: Attribution): Record<string, number> {
  if (attribution.touchpoints.length === 0) return {};
  const first = attribution.touchpoints[0];
  return { [first.channel]: attribution.conversionValue };
}

function lastTouchAttribution(attribution: Attribution): Record<string, number> {
  if (attribution.touchpoints.length === 0) return {};
  const last = attribution.touchpoints[attribution.touchpoints.length - 1];
  return { [last.channel]: attribution.conversionValue };
}

function linearAttribution(attribution: Attribution): Record<string, number> {
  const n = attribution.touchpoints.length;
  if (n === 0) return {};
  const share = attribution.conversionValue / n;
  const result: Record<string, number> = {};
  for (const tp of attribution.touchpoints) {
    result[tp.channel] = (result[tp.channel] ?? 0) + share;
  }
  return result;
}

function timeDecayAttribution(attribution: Attribution): Record<string, number> {
  if (attribution.touchpoints.length === 0) return {};
  const conversionTime = attribution.convertedAt.getTime();

  // Weight: more recent = higher weight
  const weights = attribution.touchpoints.map(tp => {
    const daysAgo = (conversionTime - tp.touchedAt.getTime()) / (1000 * 60 * 60 * 24);
    return Math.exp(-0.7 * daysAgo); // exponential decay
  });

  const totalWeight = weights.reduce((s, w) => s + w, 0);
  const result: Record<string, number> = {};
  attribution.touchpoints.forEach((tp, i) => {
    const share = (weights[i] / totalWeight) * attribution.conversionValue;
    result[tp.channel] = (result[tp.channel] ?? 0) + share;
  });
  return result;
}

function calculateROI(totalRevenueCents: number, totalCostCents: number): number {
  if (totalCostCents === 0) return Infinity;
  return ((totalRevenueCents - totalCostCents) / totalCostCents) * 100;
}

function calculateCPA(totalCostCents: number, conversions: number): number {
  if (conversions === 0) return Infinity;
  return totalCostCents / conversions;
}

function calculateRoas(totalRevenueCents: number, adSpendCents: number): number {
  if (adSpendCents === 0) return 0;
  return totalRevenueCents / adSpendCents;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const sampleAttribution: Attribution = {
  touchpoints: [
    { channel: "direct_mail", touchedAt: new Date("2024-01-01"), cost: 5000 },
    { channel: "sms", touchedAt: new Date("2024-01-10"), cost: 200 },
    { channel: "email", touchedAt: new Date("2024-01-15"), cost: 50 },
  ],
  conversionValue: 300_000_00, // $300k deal
  convertedAt: new Date("2024-01-20"),
};

describe("firstTouchAttribution", () => {
  it("assigns full value to first channel", () => {
    const result = firstTouchAttribution(sampleAttribution);
    expect(result["direct_mail"]).toBe(300_000_00);
    expect(result["sms"]).toBeUndefined();
    expect(result["email"]).toBeUndefined();
  });

  it("returns empty for no touchpoints", () => {
    expect(firstTouchAttribution({ touchpoints: [], conversionValue: 100, convertedAt: new Date() })).toEqual({});
  });
});

describe("lastTouchAttribution", () => {
  it("assigns full value to last channel", () => {
    const result = lastTouchAttribution(sampleAttribution);
    expect(result["email"]).toBe(300_000_00);
    expect(result["direct_mail"]).toBeUndefined();
  });

  it("returns empty for no touchpoints", () => {
    expect(lastTouchAttribution({ touchpoints: [], conversionValue: 100, convertedAt: new Date() })).toEqual({});
  });
});

describe("linearAttribution", () => {
  it("distributes value equally across channels", () => {
    const result = linearAttribution(sampleAttribution);
    const expectedShare = 300_000_00 / 3;
    expect(result["direct_mail"]).toBeCloseTo(expectedShare, 0);
    expect(result["sms"]).toBeCloseTo(expectedShare, 0);
    expect(result["email"]).toBeCloseTo(expectedShare, 0);
  });

  it("combines when same channel appears multiple times", () => {
    const attr: Attribution = {
      touchpoints: [
        { channel: "email", touchedAt: new Date("2024-01-01") },
        { channel: "email", touchedAt: new Date("2024-01-05") },
        { channel: "sms", touchedAt: new Date("2024-01-10") },
      ],
      conversionValue: 300,
      convertedAt: new Date("2024-01-15"),
    };
    const result = linearAttribution(attr);
    expect(result["email"]).toBeCloseTo(200, 0); // 2/3 of 300
    expect(result["sms"]).toBeCloseTo(100, 0);   // 1/3 of 300
  });
});

describe("timeDecayAttribution", () => {
  it("gives more credit to recent touchpoints", () => {
    const result = timeDecayAttribution(sampleAttribution);
    // email is most recent, so it should get more credit than direct_mail
    expect(result["email"]).toBeGreaterThan(result["direct_mail"] ?? 0);
    expect(result["email"]).toBeGreaterThan(result["sms"] ?? 0);
  });

  it("total attribution sums to conversion value", () => {
    const result = timeDecayAttribution(sampleAttribution);
    const total = Object.values(result).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(sampleAttribution.conversionValue, 0);
  });
});

describe("calculateROI", () => {
  it("calculates positive ROI", () => {
    // Revenue $10k, cost $2k → ROI = (10k - 2k) / 2k = 400%
    expect(calculateROI(10_000, 2_000)).toBe(400);
  });

  it("calculates negative ROI", () => {
    expect(calculateROI(1_000, 2_000)).toBe(-50);
  });

  it("returns Infinity for zero cost", () => {
    expect(calculateROI(5_000, 0)).toBe(Infinity);
  });
});

describe("calculateCPA", () => {
  it("calculates cost per acquisition", () => {
    expect(calculateCPA(10_000, 5)).toBe(2_000);
  });

  it("returns Infinity for 0 conversions", () => {
    expect(calculateCPA(5_000, 0)).toBe(Infinity);
  });
});

describe("calculateRoas", () => {
  it("calculates ROAS correctly", () => {
    // $5k revenue / $1k spend = 5x ROAS
    expect(calculateRoas(5_000, 1_000)).toBe(5);
  });

  it("returns 0 for zero spend", () => {
    expect(calculateRoas(5_000, 0)).toBe(0);
  });
});
