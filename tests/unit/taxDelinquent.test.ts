/**
 * T221 — Tax Delinquent Pipeline Tests
 * Tests delinquency scoring, redemption deadline calculation, and prioritization.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

function calculateDelinquencyScore(
  yearsDelinquent: number,
  totalOwedCents: number,
  propertyValueCents: number
): number {
  if (propertyValueCents <= 0) return 0;
  const ltv = totalOwedCents / propertyValueCents;
  const yearScore = Math.min(40, yearsDelinquent * 10);
  const ltvScore = Math.min(40, Math.round(ltv * 100));
  const baseScore = 20;
  return Math.min(100, baseScore + yearScore + ltvScore);
}

function estimateRedemptionDeadline(
  taxSaleDate: string,
  stateCode: string
): Date {
  // Statutory redemption periods by state (simplified)
  const redemptionMonths: Record<string, number> = {
    TX: 24, CA: 12, FL: 60, NY: 6, IL: 24, GA: 12, TN: 12, AL: 36,
  };
  const months = redemptionMonths[stateCode.toUpperCase()] ?? 12;
  const saleDate = new Date(taxSaleDate);
  const deadline = new Date(saleDate);
  deadline.setMonth(deadline.getMonth() + months);
  return deadline;
}

function classifyDelinquencyRisk(
  yearsDelinquent: number,
  daysUntilTaxSale: number
): "critical" | "high" | "medium" | "low" {
  if (daysUntilTaxSale <= 30 || yearsDelinquent >= 5) return "critical";
  if (daysUntilTaxSale <= 90 || yearsDelinquent >= 3) return "high";
  if (daysUntilTaxSale <= 180 || yearsDelinquent >= 2) return "medium";
  return "low";
}

function calculateEquityPosition(
  propertyValueCents: number,
  taxOwedCents: number,
  mortgageBalanceCents = 0
): { equityCents: number; equityPercent: number; worthPursuing: boolean } {
  const totalEncumbrance = taxOwedCents + mortgageBalanceCents;
  const equityCents = Math.max(0, propertyValueCents - totalEncumbrance);
  const equityPercent = propertyValueCents > 0 ? Math.round((equityCents / propertyValueCents) * 100) : 0;
  return {
    equityCents,
    equityPercent,
    worthPursuing: equityPercent >= 30 && equityCents >= 5_000_00, // $5k minimum equity
  };
}

function prioritizeDelinquentLeads(
  leads: Array<{ id: number; score: number; equityPercent: number; daysUntilSale: number }>
): number[] {
  return [...leads]
    .sort((a, b) => {
      // Sort by: urgency (days until sale), then equity, then score
      if (Math.abs(a.daysUntilSale - b.daysUntilSale) <= 30) {
        // Within 30 days, use equity
        const equityDiff = b.equityPercent - a.equityPercent;
        if (equityDiff !== 0) return equityDiff;
      }
      if (a.daysUntilSale !== b.daysUntilSale) return a.daysUntilSale - b.daysUntilSale;
      return b.score - a.score;
    })
    .map(l => l.id);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("calculateDelinquencyScore", () => {
  it("returns 0 for zero property value", () => {
    expect(calculateDelinquencyScore(2, 5000_00, 0)).toBe(0);
  });

  it("returns higher score for more years delinquent", () => {
    const s1 = calculateDelinquencyScore(1, 1000_00, 50000_00);
    const s2 = calculateDelinquencyScore(3, 1000_00, 50000_00);
    expect(s2).toBeGreaterThan(s1);
  });

  it("returns higher score for higher LTV", () => {
    const lowLTV = calculateDelinquencyScore(2, 1000_00, 100000_00);
    const highLTV = calculateDelinquencyScore(2, 20000_00, 50000_00);
    expect(highLTV).toBeGreaterThan(lowLTV);
  });

  it("caps at 100", () => {
    expect(calculateDelinquencyScore(10, 500000_00, 50000_00)).toBeLessThanOrEqual(100);
  });

  it("includes base score of 20 minimum", () => {
    expect(calculateDelinquencyScore(0, 0, 100000_00)).toBeGreaterThanOrEqual(20);
  });
});

describe("estimateRedemptionDeadline", () => {
  it("uses TX 24-month redemption period", () => {
    const deadline = estimateRedemptionDeadline("2024-01-01", "TX");
    expect(deadline.getFullYear()).toBe(2026);
    expect(deadline.getMonth()).toBe(0); // January
  });

  it("uses CA 12-month redemption period", () => {
    const deadline = estimateRedemptionDeadline("2024-01-01", "CA");
    expect(deadline.getFullYear()).toBe(2025);
    expect(deadline.getMonth()).toBe(0);
  });

  it("defaults to 12 months for unknown state", () => {
    const deadline = estimateRedemptionDeadline("2024-06-01", "ZZ");
    const saleDate = new Date("2024-06-01");
    const expected = new Date(saleDate);
    expected.setMonth(expected.getMonth() + 12);
    expect(deadline.toDateString()).toBe(expected.toDateString());
  });
});

describe("classifyDelinquencyRisk", () => {
  it("returns critical when tax sale within 30 days", () => {
    expect(classifyDelinquencyRisk(1, 15)).toBe("critical");
  });

  it("returns critical for 5+ years delinquent", () => {
    expect(classifyDelinquencyRisk(5, 365)).toBe("critical");
  });

  it("returns high when tax sale within 90 days", () => {
    expect(classifyDelinquencyRisk(1, 60)).toBe("high");
  });

  it("returns medium when 2 years delinquent", () => {
    expect(classifyDelinquencyRisk(2, 200)).toBe("medium");
  });

  it("returns low for early-stage delinquency", () => {
    expect(classifyDelinquencyRisk(1, 365)).toBe("low");
  });
});

describe("calculateEquityPosition", () => {
  it("calculates equity correctly", () => {
    const result = calculateEquityPosition(100000_00, 10000_00, 0);
    expect(result.equityCents).toBe(90000_00);
    expect(result.equityPercent).toBe(90);
  });

  it("returns 0 equity when encumbrance >= value", () => {
    const result = calculateEquityPosition(50000_00, 60000_00, 0);
    expect(result.equityCents).toBe(0);
    expect(result.worthPursuing).toBe(false);
  });

  it("includes mortgage in encumbrance", () => {
    const result = calculateEquityPosition(100000_00, 5000_00, 70000_00);
    expect(result.equityCents).toBe(25000_00);
  });

  it("flags worthPursuing when equity >= 30% and >= $5k", () => {
    const result = calculateEquityPosition(50000_00, 5000_00);
    expect(result.equityPercent).toBe(90);
    expect(result.worthPursuing).toBe(true);
  });

  it("not worth pursuing when equity < 30%", () => {
    const result = calculateEquityPosition(100000_00, 75000_00);
    expect(result.worthPursuing).toBe(false);
  });
});

describe("prioritizeDelinquentLeads", () => {
  it("returns empty array for empty input", () => {
    expect(prioritizeDelinquentLeads([])).toEqual([]);
  });

  it("puts most urgent (fewest days to sale) first", () => {
    const leads = [
      { id: 1, score: 50, equityPercent: 40, daysUntilSale: 120 },
      { id: 2, score: 50, equityPercent: 40, daysUntilSale: 20 },
    ];
    const priority = prioritizeDelinquentLeads(leads);
    expect(priority[0]).toBe(2);
  });

  it("uses equity to break tie within 30-day window", () => {
    const leads = [
      { id: 1, score: 80, equityPercent: 25, daysUntilSale: 15 },
      { id: 2, score: 60, equityPercent: 70, daysUntilSale: 20 },
    ];
    const priority = prioritizeDelinquentLeads(leads);
    expect(priority[0]).toBe(2); // higher equity wins
  });
});
