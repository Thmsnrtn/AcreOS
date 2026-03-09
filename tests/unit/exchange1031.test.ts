/**
 * T205 — 1031 Exchange Logic Tests
 * Tests deadline calculation, tax deferral estimation, and eligibility checks.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

const IDENTIFICATION_DAYS = 45;
const EXCHANGE_DAYS = 180;

function calculateDeadlines(saleDateIso: string): {
  identificationDeadline: Date;
  exchangeDeadline: Date;
} {
  const saleDate = new Date(saleDateIso);
  const identificationDeadline = new Date(saleDate);
  identificationDeadline.setDate(identificationDeadline.getDate() + IDENTIFICATION_DAYS);
  const exchangeDeadline = new Date(saleDate);
  exchangeDeadline.setDate(exchangeDeadline.getDate() + EXCHANGE_DAYS);
  return { identificationDeadline, exchangeDeadline };
}

function getDaysRemaining(deadline: Date, from = new Date()): number {
  return Math.max(0, Math.ceil((deadline.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));
}

function estimateTaxDeferral(
  salePriceCents: number,
  costBasisCents: number,
  capitalGainsTaxRate = 0.20
): number {
  const gain = Math.max(0, salePriceCents - costBasisCents);
  return Math.round(gain * capitalGainsTaxRate);
}

function isEligibleFor1031(
  propertyType: "land" | "rental" | "primary_residence" | "flip",
  holdDaysMin: number
): boolean {
  if (propertyType === "primary_residence") return false;
  if (propertyType === "flip" && holdDaysMin < 365) return false;
  return holdDaysMin >= 1;
}

function validateReplacementValue(
  relinquishedPriceCents: number,
  replacementPriceCents: number,
  equityReinvestedCents: number
): { valid: boolean; bootTaxableCents: number; reason?: string } {
  if (replacementPriceCents < relinquishedPriceCents) {
    return {
      valid: false,
      bootTaxableCents: relinquishedPriceCents - replacementPriceCents,
      reason: "Replacement property value must be >= relinquished value for full deferral",
    };
  }
  const reinvested = Math.min(equityReinvestedCents, replacementPriceCents);
  const boot = Math.max(0, relinquishedPriceCents - reinvested);
  return { valid: boot === 0, bootTaxableCents: boot };
}

function getExchangeStatus(
  identificationDaysLeft: number,
  exchangeDaysLeft: number,
  identifiedCount: number
): "on_track" | "identification_urgent" | "exchange_urgent" | "needs_identification" | "expired" {
  if (exchangeDaysLeft <= 0) return "expired";
  if (identificationDaysLeft <= 0 && identifiedCount === 0) return "expired";
  if (exchangeDaysLeft <= 30) return "exchange_urgent";
  if (identifiedCount === 0 && identificationDaysLeft <= 10) return "needs_identification";
  if (identificationDaysLeft <= 10) return "identification_urgent";
  return "on_track";
}

function canAddReplacementProperty(
  identificationDeadline: Date,
  currentCount: number,
  from = new Date()
): { allowed: boolean; reason?: string } {
  if (from > identificationDeadline) {
    return { allowed: false, reason: "Identification period has expired" };
  }
  if (currentCount >= 3) {
    return { allowed: false, reason: "Maximum 3 properties can be identified (IRS 3-property rule)" };
  }
  return { allowed: true };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("calculateDeadlines", () => {
  it("sets identification deadline to 45 days after sale", () => {
    const { identificationDeadline } = calculateDeadlines("2024-01-01");
    const expected = new Date("2024-01-01");
    expected.setDate(expected.getDate() + 45);
    expect(identificationDeadline.toDateString()).toBe(expected.toDateString());
  });

  it("sets exchange deadline to 180 days after sale", () => {
    const { exchangeDeadline } = calculateDeadlines("2024-01-01");
    const expected = new Date("2024-01-01");
    expected.setDate(expected.getDate() + 180);
    expect(exchangeDeadline.toDateString()).toBe(expected.toDateString());
  });

  it("exchange deadline is always after identification deadline", () => {
    const { identificationDeadline, exchangeDeadline } = calculateDeadlines("2024-06-01");
    expect(exchangeDeadline.getTime()).toBeGreaterThan(identificationDeadline.getTime());
  });
});

describe("getDaysRemaining", () => {
  it("returns 0 for past deadline", () => {
    const past = new Date(Date.now() - 86400000 * 5);
    expect(getDaysRemaining(past)).toBe(0);
  });

  it("returns positive days for future deadline", () => {
    const future = new Date(Date.now() + 86400000 * 10);
    const days = getDaysRemaining(future);
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThanOrEqual(10);
  });

  it("uses reference date parameter", () => {
    const refDate = new Date("2024-01-01");
    const deadline = new Date("2024-01-11");
    expect(getDaysRemaining(deadline, refDate)).toBe(10);
  });
});

describe("estimateTaxDeferral", () => {
  it("calculates 20% capital gains deferral", () => {
    // Sale: $500k, Cost: $100k, Gain: $400k, Tax deferred: $80k
    expect(estimateTaxDeferral(50_000_000, 10_000_000)).toBe(8_000_000);
  });

  it("returns 0 when there is no gain", () => {
    expect(estimateTaxDeferral(10_000_000, 10_000_000)).toBe(0);
  });

  it("returns 0 when sold at a loss", () => {
    expect(estimateTaxDeferral(5_000_000, 10_000_000)).toBe(0);
  });

  it("accepts custom tax rate", () => {
    expect(estimateTaxDeferral(20_000_000, 10_000_000, 0.15)).toBe(1_500_000);
  });
});

describe("isEligibleFor1031", () => {
  it("allows land held for any duration", () => {
    expect(isEligibleFor1031("land", 30)).toBe(true);
  });

  it("disallows primary residence", () => {
    expect(isEligibleFor1031("primary_residence", 730)).toBe(false);
  });

  it("disallows short-term flip (< 365 days)", () => {
    expect(isEligibleFor1031("flip", 200)).toBe(false);
  });

  it("allows flip held > 365 days", () => {
    expect(isEligibleFor1031("flip", 400)).toBe(true);
  });

  it("allows rental property", () => {
    expect(isEligibleFor1031("rental", 60)).toBe(true);
  });
});

describe("validateReplacementValue", () => {
  it("returns valid when replacement >= relinquished", () => {
    const result = validateReplacementValue(50_000_000, 60_000_000, 50_000_000);
    expect(result.valid).toBe(true);
    expect(result.bootTaxableCents).toBe(0);
  });

  it("returns invalid with taxable boot when replacement < relinquished", () => {
    const result = validateReplacementValue(50_000_000, 40_000_000, 40_000_000);
    expect(result.valid).toBe(false);
    expect(result.bootTaxableCents).toBeGreaterThan(0);
    expect(result.reason).toContain("Replacement property value");
  });
});

describe("getExchangeStatus", () => {
  it("returns on_track when plenty of time and properties identified", () => {
    expect(getExchangeStatus(30, 100, 2)).toBe("on_track");
  });

  it("returns needs_identification when no properties identified and id deadline near", () => {
    expect(getExchangeStatus(5, 150, 0)).toBe("needs_identification");
  });

  it("returns identification_urgent when deadline near but have identified properties", () => {
    expect(getExchangeStatus(5, 150, 2)).toBe("identification_urgent");
  });

  it("returns exchange_urgent when exchange deadline near", () => {
    expect(getExchangeStatus(0, 15, 2)).toBe("exchange_urgent");
  });

  it("returns expired when both deadlines passed with no identification", () => {
    expect(getExchangeStatus(0, 0, 0)).toBe("expired");
  });
});

describe("canAddReplacementProperty", () => {
  it("allows adding when within deadline and under 3 properties", () => {
    const future = new Date(Date.now() + 86400000 * 20);
    const result = canAddReplacementProperty(future, 1);
    expect(result.allowed).toBe(true);
  });

  it("blocks adding after identification deadline", () => {
    const past = new Date(Date.now() - 86400000);
    const result = canAddReplacementProperty(past, 0);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("expired");
  });

  it("blocks adding a 4th property (IRS 3-property rule)", () => {
    const future = new Date(Date.now() + 86400000 * 20);
    const result = canAddReplacementProperty(future, 3);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("3 properties");
  });
});
