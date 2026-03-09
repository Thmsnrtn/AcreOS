/**
 * T130 — Buyer Matching AI Unit Tests
 *
 * Tests buyer-property compatibility scoring:
 * - Budget fit
 * - Acreage preference matching
 * - Geographic preference alignment
 * - Property type matching
 * - Investor profile scoring
 * - Match ranking and filtering
 */

import { describe, it, expect } from "vitest";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BuyerProfile {
  id: string;
  maxBudget: number;
  minAcres?: number;
  maxAcres?: number;
  preferredStates: string[];
  preferredCounties?: string[];
  propertyTypes: string[];
  minROI?: number;
  cashBuyer?: boolean;
  closingSpeed?: "fast" | "normal" | "flexible";
}

interface PropertyListing {
  id: string;
  price: number;
  acres: number;
  state: string;
  county: string;
  propertyType: string;
  projectedROI?: number;
  daysToClose?: number;
}

// ── Pure matching helpers ─────────────────────────────────────────────────────

function calcBudgetScore(buyer: BuyerProfile, property: PropertyListing): number {
  if (property.price > buyer.maxBudget) return 0;
  const utilization = property.price / buyer.maxBudget;
  // Sweet spot: 60-90% of budget
  if (utilization >= 0.6 && utilization <= 0.9) return 100;
  if (utilization < 0.6) return Math.round(utilization / 0.6 * 80);
  // Over 90% but under 100%
  return Math.round((1 - utilization) / 0.1 * 80);
}

function calcAcreageScore(buyer: BuyerProfile, property: PropertyListing): number {
  const { minAcres, maxAcres } = buyer;
  if (!minAcres && !maxAcres) return 100; // No preference → full score

  const min = minAcres ?? 0;
  const max = maxAcres ?? Infinity;

  if (property.acres >= min && property.acres <= max) return 100;

  // Partial score for close matches
  if (property.acres < min) {
    const gap = (min - property.acres) / min;
    return Math.max(0, Math.round((1 - gap) * 70));
  } else {
    // Over max
    const gap = (property.acres - max) / max;
    return Math.max(0, Math.round((1 - gap) * 60));
  }
}

function calcGeographyScore(buyer: BuyerProfile, property: PropertyListing): number {
  const stateMatch = buyer.preferredStates.includes(property.state);
  const countyMatch =
    !buyer.preferredCounties ||
    buyer.preferredCounties.length === 0 ||
    buyer.preferredCounties.includes(property.county);

  if (stateMatch && countyMatch) return 100;
  if (stateMatch && !countyMatch) return 60;
  return 0;
}

function calcPropertyTypeScore(buyer: BuyerProfile, property: PropertyListing): number {
  return buyer.propertyTypes.includes(property.propertyType) ? 100 : 0;
}

function calcROIScore(buyer: BuyerProfile, property: PropertyListing): number {
  if (!buyer.minROI || !property.projectedROI) return 75; // No requirement
  if (property.projectedROI >= buyer.minROI) return 100;
  const ratio = property.projectedROI / buyer.minROI;
  return Math.round(ratio * 100);
}

function calcOverallMatchScore(buyer: BuyerProfile, property: PropertyListing): number {
  const budget = calcBudgetScore(buyer, property);
  if (budget === 0) return 0; // Hard disqualifier

  const acreage = calcAcreageScore(buyer, property);
  const geography = calcGeographyScore(buyer, property);
  if (geography === 0) return 0; // Out of market

  const propertyType = calcPropertyTypeScore(buyer, property);
  const roi = calcROIScore(buyer, property);

  // Weighted composite
  return Math.round(
    budget * 0.30 +
    acreage * 0.20 +
    geography * 0.25 +
    propertyType * 0.15 +
    roi * 0.10
  );
}

function rankMatches(
  buyer: BuyerProfile,
  properties: PropertyListing[],
  minScore: number = 40
): Array<{ property: PropertyListing; score: number }> {
  return properties
    .map(p => ({ property: p, score: calcOverallMatchScore(buyer, p) }))
    .filter(m => m.score >= minScore)
    .sort((a, b) => b.score - a.score);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Budget Score", () => {
  const buyer: BuyerProfile = {
    id: "b1",
    maxBudget: 100_000,
    preferredStates: ["TX"],
    propertyTypes: ["land"],
  };

  it("returns 0 if property exceeds budget", () => {
    const prop = { id: "p1", price: 110_000, acres: 50, state: "TX", county: "Travis", propertyType: "land" };
    expect(calcBudgetScore(buyer, prop)).toBe(0);
  });

  it("returns 100 for price in sweet spot (60–90% of budget)", () => {
    const prop = { id: "p1", price: 75_000, acres: 50, state: "TX", county: "Travis", propertyType: "land" };
    expect(calcBudgetScore(buyer, prop)).toBe(100);
  });

  it("returns lower score for very cheap property (<60% of budget)", () => {
    const prop = { id: "p1", price: 20_000, acres: 50, state: "TX", county: "Travis", propertyType: "land" };
    expect(calcBudgetScore(buyer, prop)).toBeLessThan(100);
  });

  it("returns score > 0 but < 100 for property near budget limit (90–100%)", () => {
    const prop = { id: "p1", price: 95_000, acres: 50, state: "TX", county: "Travis", propertyType: "land" };
    const score = calcBudgetScore(buyer, prop);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
  });
});

describe("Acreage Score", () => {
  it("returns 100 when no acreage preference specified", () => {
    const buyer: BuyerProfile = { id: "b1", maxBudget: 100_000, preferredStates: ["TX"], propertyTypes: ["land"] };
    const prop = { id: "p1", price: 50_000, acres: 500, state: "TX", county: "Travis", propertyType: "land" };
    expect(calcAcreageScore(buyer, prop)).toBe(100);
  });

  it("returns 100 when property is within preferred range", () => {
    const buyer: BuyerProfile = { id: "b1", maxBudget: 100_000, minAcres: 10, maxAcres: 100, preferredStates: ["TX"], propertyTypes: ["land"] };
    const prop = { id: "p1", price: 50_000, acres: 50, state: "TX", county: "Travis", propertyType: "land" };
    expect(calcAcreageScore(buyer, prop)).toBe(100);
  });

  it("reduces score when property is below minimum acres", () => {
    const buyer: BuyerProfile = { id: "b1", maxBudget: 100_000, minAcres: 100, preferredStates: ["TX"], propertyTypes: ["land"] };
    const prop = { id: "p1", price: 50_000, acres: 20, state: "TX", county: "Travis", propertyType: "land" };
    expect(calcAcreageScore(buyer, prop)).toBeLessThan(100);
  });

  it("reduces score when property is above maximum acres", () => {
    const buyer: BuyerProfile = { id: "b1", maxBudget: 100_000, maxAcres: 50, preferredStates: ["TX"], propertyTypes: ["land"] };
    const prop = { id: "p1", price: 50_000, acres: 200, state: "TX", county: "Travis", propertyType: "land" };
    expect(calcAcreageScore(buyer, prop)).toBeLessThan(100);
  });
});

describe("Geography Score", () => {
  it("returns 100 for exact state and county match", () => {
    const buyer: BuyerProfile = {
      id: "b1",
      maxBudget: 100_000,
      preferredStates: ["TX"],
      preferredCounties: ["Travis"],
      propertyTypes: ["land"],
    };
    const prop = { id: "p1", price: 50_000, acres: 50, state: "TX", county: "Travis", propertyType: "land" };
    expect(calcGeographyScore(buyer, prop)).toBe(100);
  });

  it("returns 60 for state match but county mismatch", () => {
    const buyer: BuyerProfile = {
      id: "b1",
      maxBudget: 100_000,
      preferredStates: ["TX"],
      preferredCounties: ["Travis"],
      propertyTypes: ["land"],
    };
    const prop = { id: "p1", price: 50_000, acres: 50, state: "TX", county: "Hays", propertyType: "land" };
    expect(calcGeographyScore(buyer, prop)).toBe(60);
  });

  it("returns 0 for state mismatch", () => {
    const buyer: BuyerProfile = {
      id: "b1",
      maxBudget: 100_000,
      preferredStates: ["TX"],
      propertyTypes: ["land"],
    };
    const prop = { id: "p1", price: 50_000, acres: 50, state: "FL", county: "Marion", propertyType: "land" };
    expect(calcGeographyScore(buyer, prop)).toBe(0);
  });

  it("returns 100 when buyer has no county preference", () => {
    const buyer: BuyerProfile = {
      id: "b1",
      maxBudget: 100_000,
      preferredStates: ["TX"],
      propertyTypes: ["land"],
    };
    const prop = { id: "p1", price: 50_000, acres: 50, state: "TX", county: "AnyCounty", propertyType: "land" };
    expect(calcGeographyScore(buyer, prop)).toBe(100);
  });
});

describe("Property Type Score", () => {
  it("returns 100 for matching property type", () => {
    const buyer: BuyerProfile = { id: "b1", maxBudget: 100_000, preferredStates: ["TX"], propertyTypes: ["farmland", "timberland"] };
    const prop = { id: "p1", price: 50_000, acres: 50, state: "TX", county: "Travis", propertyType: "farmland" };
    expect(calcPropertyTypeScore(buyer, prop)).toBe(100);
  });

  it("returns 0 for non-matching type", () => {
    const buyer: BuyerProfile = { id: "b1", maxBudget: 100_000, preferredStates: ["TX"], propertyTypes: ["farmland"] };
    const prop = { id: "p1", price: 50_000, acres: 50, state: "TX", county: "Travis", propertyType: "hunting" };
    expect(calcPropertyTypeScore(buyer, prop)).toBe(0);
  });
});

describe("Overall Match Score", () => {
  const buyer: BuyerProfile = {
    id: "b1",
    maxBudget: 100_000,
    minAcres: 20,
    maxAcres: 100,
    preferredStates: ["TX"],
    preferredCounties: ["Travis"],
    propertyTypes: ["land"],
    minROI: 10,
  };

  it("returns 0 for over-budget property", () => {
    const prop = { id: "p1", price: 120_000, acres: 50, state: "TX", county: "Travis", propertyType: "land", projectedROI: 15 };
    expect(calcOverallMatchScore(buyer, prop)).toBe(0);
  });

  it("returns 0 for out-of-market property", () => {
    const prop = { id: "p1", price: 50_000, acres: 50, state: "CA", county: "LA", propertyType: "land", projectedROI: 15 };
    expect(calcOverallMatchScore(buyer, prop)).toBe(0);
  });

  it("returns high score for perfect match", () => {
    const prop = { id: "p1", price: 75_000, acres: 50, state: "TX", county: "Travis", propertyType: "land", projectedROI: 15 };
    expect(calcOverallMatchScore(buyer, prop)).toBeGreaterThan(70);
  });
});

describe("Match Ranking", () => {
  const buyer: BuyerProfile = {
    id: "b1",
    maxBudget: 200_000,
    minAcres: 20,
    maxAcres: 200,
    preferredStates: ["TX"],
    propertyTypes: ["land"],
    minROI: 10,
  };

  const properties: PropertyListing[] = [
    { id: "p1", price: 150_000, acres: 80, state: "TX", county: "Travis", propertyType: "land", projectedROI: 15 },
    { id: "p2", price: 50_000, acres: 30, state: "TX", county: "Hays", propertyType: "land", projectedROI: 12 },
    { id: "p3", price: 300_000, acres: 100, state: "TX", county: "Travis", propertyType: "land", projectedROI: 20 }, // over budget
    { id: "p4", price: 100_000, acres: 50, state: "FL", county: "Marion", propertyType: "land", projectedROI: 18 }, // wrong state
  ];

  it("filters out disqualified properties", () => {
    const matches = rankMatches(buyer, properties, 30);
    const ids = matches.map(m => m.property.id);
    expect(ids).not.toContain("p3"); // over budget
    expect(ids).not.toContain("p4"); // wrong state
  });

  it("sorts matches by score descending", () => {
    const matches = rankMatches(buyer, properties, 30);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
    }
  });

  it("returns empty array when no properties meet minimum score", () => {
    const terrible = [
      { id: "p1", price: 500_000, acres: 5, state: "CA", county: "X", propertyType: "commercial", projectedROI: 2 },
    ];
    expect(rankMatches(buyer, terrible, 30)).toHaveLength(0);
  });
});
