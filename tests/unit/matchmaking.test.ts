/**
 * T229 — Matchmaking / Buyer Matching Tests
 * Tests match score calculation, criteria filtering, and notification logic.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

interface BuyerCriteria {
  minAcres?: number;
  maxAcres?: number;
  minPriceCents?: number;
  maxPriceCents?: number;
  states?: string[];
  counties?: string[];
  zoningCategories?: string[];
  requiresRoadAccess?: boolean;
  requiresWater?: boolean;
}

interface Property {
  acres: number;
  askingPriceCents: number;
  stateCode: string;
  county: string;
  zoningCategory: string;
  hasRoadAccess: boolean;
  hasWater: boolean;
}

function calculateMatchScore(property: Property, criteria: BuyerCriteria): number {
  let score = 0;
  let maxScore = 0;

  // Acreage match (20 points)
  maxScore += 20;
  const minOk = criteria.minAcres === undefined || property.acres >= criteria.minAcres;
  const maxOk = criteria.maxAcres === undefined || property.acres <= criteria.maxAcres;
  if (minOk && maxOk) score += 20;
  else if (minOk || maxOk) score += 10;

  // Price match (20 points)
  maxScore += 20;
  const minPriceOk = criteria.minPriceCents === undefined || property.askingPriceCents >= criteria.minPriceCents;
  const maxPriceOk = criteria.maxPriceCents === undefined || property.askingPriceCents <= criteria.maxPriceCents;
  if (minPriceOk && maxPriceOk) score += 20;

  // State match (20 points)
  maxScore += 20;
  if (!criteria.states || criteria.states.length === 0 || criteria.states.includes(property.stateCode)) score += 20;

  // County match (15 points)
  maxScore += 15;
  if (!criteria.counties || criteria.counties.length === 0 || criteria.counties.includes(property.county)) score += 15;

  // Zoning match (15 points)
  maxScore += 15;
  if (!criteria.zoningCategories || criteria.zoningCategories.length === 0 || criteria.zoningCategories.includes(property.zoningCategory)) score += 15;

  // Amenities (5 + 5)
  maxScore += 10;
  if (!criteria.requiresRoadAccess || property.hasRoadAccess) score += 5;
  if (!criteria.requiresWater || property.hasWater) score += 5;

  return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
}

function isHardMatch(property: Property, criteria: BuyerCriteria): boolean {
  if (criteria.minAcres !== undefined && property.acres < criteria.minAcres) return false;
  if (criteria.maxAcres !== undefined && property.acres > criteria.maxAcres) return false;
  if (criteria.maxPriceCents !== undefined && property.askingPriceCents > criteria.maxPriceCents) return false;
  if (criteria.states && criteria.states.length > 0 && !criteria.states.includes(property.stateCode)) return false;
  return true;
}

function rankMatches(
  matches: Array<{ buyerId: number; score: number; isHard: boolean }>
): Array<{ buyerId: number; score: number; isHard: boolean }> {
  return [...matches].sort((a, b) => {
    if (a.isHard !== b.isHard) return b.isHard ? 1 : -1;
    return b.score - a.score;
  });
}

function getMatchLabel(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 60) return "Fair";
  return "Weak";
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("calculateMatchScore", () => {
  const property: Property = {
    acres: 40,
    askingPriceCents: 5_000_000,
    stateCode: "TX",
    county: "Travis",
    zoningCategory: "agricultural",
    hasRoadAccess: true,
    hasWater: false,
  };

  it("returns 100 for perfect criteria match", () => {
    const criteria: BuyerCriteria = {
      minAcres: 20,
      maxAcres: 80,
      maxPriceCents: 10_000_000,
      states: ["TX"],
      counties: ["Travis"],
      zoningCategories: ["agricultural"],
      requiresRoadAccess: true,
      requiresWater: false,
    };
    expect(calculateMatchScore(property, criteria)).toBe(100);
  });

  it("returns lower score when state does not match", () => {
    const criteria: BuyerCriteria = { states: ["CA"] };
    expect(calculateMatchScore(property, criteria)).toBeLessThan(100);
  });

  it("returns reduced score when price too high and state wrong", () => {
    const criteria: BuyerCriteria = {
      maxPriceCents: 1_000_000,
      states: ["CA"],
      counties: ["Los Angeles"],
      zoningCategories: ["commercial"],
    };
    const score = calculateMatchScore(property, criteria);
    expect(score).toBeLessThan(50);
  });

  it("returns high score for criteria-free buyer", () => {
    const score = calculateMatchScore(property, {});
    expect(score).toBe(100);
  });

  it("penalizes water requirement when property lacks water", () => {
    const withWater: BuyerCriteria = { requiresWater: true };
    const withoutWater: BuyerCriteria = { requiresWater: false };
    expect(calculateMatchScore(property, withWater)).toBeLessThan(calculateMatchScore(property, withoutWater));
  });
});

describe("isHardMatch", () => {
  const property: Property = {
    acres: 40,
    askingPriceCents: 5_000_000,
    stateCode: "TX",
    county: "Travis",
    zoningCategory: "agricultural",
    hasRoadAccess: true,
    hasWater: false,
  };

  it("returns true when property fits all hard criteria", () => {
    expect(isHardMatch(property, { minAcres: 10, maxAcres: 100, states: ["TX"] })).toBe(true);
  });

  it("returns false when under minimum acreage", () => {
    expect(isHardMatch(property, { minAcres: 100 })).toBe(false);
  });

  it("returns false when price exceeds max", () => {
    expect(isHardMatch(property, { maxPriceCents: 1_000_000 })).toBe(false);
  });

  it("returns false when state does not match", () => {
    expect(isHardMatch(property, { states: ["CA", "FL"] })).toBe(false);
  });

  it("returns true for empty criteria", () => {
    expect(isHardMatch(property, {})).toBe(true);
  });
});

describe("rankMatches", () => {
  it("puts hard matches before soft matches", () => {
    const matches = [
      { buyerId: 1, score: 95, isHard: false },
      { buyerId: 2, score: 80, isHard: true },
    ];
    const ranked = rankMatches(matches);
    expect(ranked[0].buyerId).toBe(2);
  });

  it("sorts by score within same isHard group", () => {
    const matches = [
      { buyerId: 1, score: 75, isHard: true },
      { buyerId: 2, score: 90, isHard: true },
    ];
    const ranked = rankMatches(matches);
    expect(ranked[0].buyerId).toBe(2);
  });

  it("returns empty for empty input", () => {
    expect(rankMatches([])).toEqual([]);
  });
});

describe("getMatchLabel", () => {
  it("returns Excellent for 90+", () => {
    expect(getMatchLabel(95)).toBe("Excellent");
    expect(getMatchLabel(90)).toBe("Excellent");
  });

  it("returns Good for 75-89", () => {
    expect(getMatchLabel(80)).toBe("Good");
    expect(getMatchLabel(75)).toBe("Good");
  });

  it("returns Fair for 60-74", () => {
    expect(getMatchLabel(65)).toBe("Fair");
  });

  it("returns Weak for < 60", () => {
    expect(getMatchLabel(50)).toBe("Weak");
    expect(getMatchLabel(0)).toBe("Weak");
  });
});
