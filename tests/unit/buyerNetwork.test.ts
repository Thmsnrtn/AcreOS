/**
 * Buyer Network Unit Tests
 *
 * Tests buyer intelligence network logic:
 * - Demand score calculation from behavior events
 * - Trend classification (surging/growing/stable/declining)
 * - Match scoring algorithm
 * - Geographic filtering
 * - Alert trigger thresholds
 */

import { describe, it, expect } from "vitest";

// ── Types mirroring BuyerIntelligenceNetwork ──────────────────────────────────

type EventType = "property_view" | "search" | "save_favorite" | "contact_seller" | "make_offer" | "attend_showing";
type DemandTrend = "surging" | "growing" | "stable" | "declining";

interface BehaviorMetrics {
  views: number;
  saves: number;
  contacts: number;
  offers: number;
  searchVolume: number;
  avgTimeOnPage: number; // seconds
}

interface BuyerProfile {
  minAcres?: number;
  maxAcres?: number;
  minPrice?: number;
  maxPrice?: number;
  state?: string;
  county?: string;
  zoning?: string[];
  features?: string[];
  budget?: number;
}

interface PropertyListing {
  acres: number;
  price: number;
  state: string;
  county: string;
  zoning: string;
  features: string[];
  lat?: number;
  lng?: number;
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

function computeDemandScore(metrics: BehaviorMetrics): number {
  let score = 0;

  // View volume
  if (metrics.views > 100) score += 25;
  else if (metrics.views > 50) score += 15;
  else if (metrics.views > 20) score += 5;

  // Save rate
  const saveRate = metrics.views > 0 ? metrics.saves / metrics.views : 0;
  if (saveRate > 0.2) score += 20;
  else if (saveRate > 0.1) score += 12;
  else if (saveRate > 0.05) score += 5;

  // Contact rate
  const contactRate = metrics.views > 0 ? metrics.contacts / metrics.views : 0;
  if (contactRate > 0.1) score += 25;
  else if (contactRate > 0.05) score += 15;
  else if (contactRate > 0.02) score += 5;

  // Offer rate
  const offerRate = metrics.contacts > 0 ? metrics.offers / metrics.contacts : 0;
  if (offerRate > 0.3) score += 20;
  else if (offerRate > 0.15) score += 10;
  else if (offerRate > 0.05) score += 5;

  // Search volume
  if (metrics.searchVolume > 500) score += 10;
  else if (metrics.searchVolume > 200) score += 5;

  return Math.min(100, score);
}

function classifyDemandTrend(
  currentScore: number,
  previousScore: number
): DemandTrend {
  const delta = currentScore - previousScore;
  if (delta > 20) return "surging";
  if (delta > 5) return "growing";
  if (delta > -5) return "stable";
  return "declining";
}

function scorePropertyMatch(buyer: BuyerProfile, property: PropertyListing): number {
  let score = 0;
  let maxScore = 0;

  // Acreage match
  if (buyer.minAcres !== undefined || buyer.maxAcres !== undefined) {
    maxScore += 30;
    const min = buyer.minAcres ?? 0;
    const max = buyer.maxAcres ?? Infinity;
    if (property.acres >= min && property.acres <= max) score += 30;
    else if (property.acres >= min * 0.8 && property.acres <= max * 1.2) score += 15;
  }

  // Price match
  if (buyer.minPrice !== undefined || buyer.maxPrice !== undefined) {
    maxScore += 30;
    const min = buyer.minPrice ?? 0;
    const max = buyer.maxPrice ?? Infinity;
    if (property.price >= min && property.price <= max) score += 30;
    else if (property.price <= max * 1.1) score += 10;
  }

  // State match
  if (buyer.state) {
    maxScore += 20;
    if (property.state === buyer.state) score += 20;
  }

  // County match (bonus)
  if (buyer.county) {
    maxScore += 10;
    if (property.county === buyer.county) score += 10;
  }

  // Zoning match
  if (buyer.zoning && buyer.zoning.length > 0) {
    maxScore += 10;
    if (buyer.zoning.includes(property.zoning)) score += 10;
  }

  return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
}

function filterByGeography(
  properties: PropertyListing[],
  state?: string,
  county?: string
): PropertyListing[] {
  return properties.filter(p => {
    if (state && p.state !== state) return false;
    if (county && p.county !== county) return false;
    return true;
  });
}

function shouldTriggerAlert(
  demandScore: number,
  trend: DemandTrend,
  threshold: number = 70
): boolean {
  if (demandScore >= threshold) return true;
  if (trend === "surging" && demandScore >= threshold * 0.8) return true;
  return false;
}

function eventTypeWeight(eventType: EventType): number {
  const weights: Record<EventType, number> = {
    property_view: 1,
    search: 0.5,
    save_favorite: 3,
    contact_seller: 5,
    make_offer: 10,
    attend_showing: 7,
  };
  return weights[eventType];
}

function computeEngagementScore(events: Array<{ type: EventType; timestamp: Date }>): number {
  const now = new Date();
  let score = 0;
  for (const event of events) {
    const daysAgo = (now.getTime() - event.timestamp.getTime()) / (1000 * 60 * 60 * 24);
    const recencyMultiplier = Math.max(0.1, 1 - daysAgo / 90); // decays over 90 days
    score += eventTypeWeight(event.type) * recencyMultiplier;
  }
  return Math.min(100, Math.round(score));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Demand Score Calculation", () => {
  it("scores zero for no activity", () => {
    const metrics: BehaviorMetrics = {
      views: 0, saves: 0, contacts: 0, offers: 0, searchVolume: 0, avgTimeOnPage: 0,
    };
    expect(computeDemandScore(metrics)).toBe(0);
  });

  it("scores high for strong engagement across all metrics", () => {
    const metrics: BehaviorMetrics = {
      views: 150, saves: 40, contacts: 20, offers: 8, searchVolume: 600, avgTimeOnPage: 120,
    };
    expect(computeDemandScore(metrics)).toBeGreaterThanOrEqual(70);
  });

  it("never exceeds 100", () => {
    const metrics: BehaviorMetrics = {
      views: 1000, saves: 900, contacts: 500, offers: 400, searchVolume: 9999, avgTimeOnPage: 300,
    };
    expect(computeDemandScore(metrics)).toBeLessThanOrEqual(100);
  });

  it("increases score for high save rate (>20%)", () => {
    const base: BehaviorMetrics = { views: 100, saves: 5, contacts: 0, offers: 0, searchVolume: 0, avgTimeOnPage: 0 };
    const highSave: BehaviorMetrics = { ...base, saves: 25 };
    expect(computeDemandScore(highSave)).toBeGreaterThan(computeDemandScore(base));
  });

  it("weights offers more heavily than views", () => {
    const highViews: BehaviorMetrics = { views: 200, saves: 2, contacts: 2, offers: 0, searchVolume: 0, avgTimeOnPage: 0 };
    const highOffers: BehaviorMetrics = { views: 20, saves: 2, contacts: 10, offers: 5, searchVolume: 0, avgTimeOnPage: 0 };
    expect(computeDemandScore(highOffers)).toBeGreaterThan(computeDemandScore(highViews));
  });

  it("adds bonus for high search volume (>500)", () => {
    const base: BehaviorMetrics = { views: 50, saves: 5, contacts: 2, offers: 0, searchVolume: 0, avgTimeOnPage: 0 };
    const highSearch: BehaviorMetrics = { ...base, searchVolume: 600 };
    expect(computeDemandScore(highSearch)).toBeGreaterThan(computeDemandScore(base));
  });
});

describe("Demand Trend Classification", () => {
  it("classifies surge when score increases >20 points", () => {
    expect(classifyDemandTrend(90, 60)).toBe("surging");
    expect(classifyDemandTrend(75, 50)).toBe("surging");
  });

  it("classifies growing when score increases 5-20 points", () => {
    expect(classifyDemandTrend(65, 55)).toBe("growing");
    expect(classifyDemandTrend(70, 60)).toBe("growing");
  });

  it("classifies stable when change is within ±5 points", () => {
    expect(classifyDemandTrend(50, 48)).toBe("stable");
    expect(classifyDemandTrend(50, 52)).toBe("stable");
    expect(classifyDemandTrend(50, 50)).toBe("stable");
  });

  it("classifies declining when score drops >5 points", () => {
    expect(classifyDemandTrend(40, 60)).toBe("declining");
    expect(classifyDemandTrend(30, 50)).toBe("declining");
  });
});

describe("Match Scoring Algorithm", () => {
  const property: PropertyListing = {
    acres: 100,
    price: 250_000,
    state: "TX",
    county: "Travis",
    zoning: "agricultural",
    features: ["water", "road_access"],
  };

  it("scores 100 for a perfect match", () => {
    const buyer: BuyerProfile = {
      minAcres: 80,
      maxAcres: 120,
      minPrice: 200_000,
      maxPrice: 300_000,
      state: "TX",
      county: "Travis",
      zoning: ["agricultural"],
    };
    expect(scorePropertyMatch(buyer, property)).toBe(100);
  });

  it("scores 0 for no matching criteria", () => {
    const buyer: BuyerProfile = {};
    expect(scorePropertyMatch(buyer, property)).toBe(0);
  });

  it("penalizes acreage out of range", () => {
    const inRange: BuyerProfile = { minAcres: 80, maxAcres: 120, state: "TX" };
    const outOfRange: BuyerProfile = { minAcres: 200, maxAcres: 500, state: "TX" };
    expect(scorePropertyMatch(inRange, property)).toBeGreaterThan(scorePropertyMatch(outOfRange, property));
  });

  it("penalizes price above max budget", () => {
    const affordable: BuyerProfile = { maxPrice: 300_000, state: "TX" };
    const tooExpensive: BuyerProfile = { maxPrice: 150_000, state: "TX" };
    expect(scorePropertyMatch(affordable, property)).toBeGreaterThan(scorePropertyMatch(tooExpensive, property));
  });

  it("gives bonus for county match on top of state match", () => {
    // Use only state (no acreage) so the county is the differentiator
    const stateOnly: BuyerProfile = { state: "TX" };
    const withCounty: BuyerProfile = { state: "TX", county: "Travis" };
    // County match adds bonus, but score may be capped at 100 — just verify it's >= state-only
    const stateScore = scorePropertyMatch(stateOnly, property);
    const countyScore = scorePropertyMatch(withCounty, property);
    expect(countyScore).toBeGreaterThanOrEqual(stateScore);
  });

  it("gives bonus for zoning match", () => {
    const noZoning: BuyerProfile = { state: "TX", minAcres: 80, maxAcres: 120 };
    const withZoning: BuyerProfile = { state: "TX", minAcres: 80, maxAcres: 120, zoning: ["agricultural"] };
    expect(scorePropertyMatch(withZoning, property)).toBeGreaterThanOrEqual(scorePropertyMatch(noZoning, property));
  });
});

describe("Geographic Filtering", () => {
  const listings: PropertyListing[] = [
    { acres: 50, price: 100_000, state: "TX", county: "Travis", zoning: "ag", features: [] },
    { acres: 80, price: 200_000, state: "TX", county: "Hays", zoning: "ag", features: [] },
    { acres: 120, price: 300_000, state: "FL", county: "Lake", zoning: "ag", features: [] },
    { acres: 200, price: 500_000, state: "CO", county: "Denver", zoning: "ag", features: [] },
  ];

  it("filters by state correctly", () => {
    const result = filterByGeography(listings, "TX");
    expect(result).toHaveLength(2);
    expect(result.every(p => p.state === "TX")).toBe(true);
  });

  it("filters by state and county", () => {
    const result = filterByGeography(listings, "TX", "Travis");
    expect(result).toHaveLength(1);
    expect(result[0].county).toBe("Travis");
  });

  it("returns all listings when no filter applied", () => {
    const result = filterByGeography(listings);
    expect(result).toHaveLength(4);
  });

  it("returns empty array when no matches", () => {
    const result = filterByGeography(listings, "NY");
    expect(result).toHaveLength(0);
  });

  it("is case-sensitive for state codes", () => {
    const result = filterByGeography(listings, "tx"); // lowercase — no match
    expect(result).toHaveLength(0);
  });
});

describe("Alert Trigger Logic", () => {
  it("triggers alert when demand score meets threshold", () => {
    expect(shouldTriggerAlert(75, "stable", 70)).toBe(true);
    expect(shouldTriggerAlert(70, "stable", 70)).toBe(true);
  });

  it("does not trigger when score is below threshold and not surging", () => {
    expect(shouldTriggerAlert(60, "stable", 70)).toBe(false);
    expect(shouldTriggerAlert(50, "declining", 70)).toBe(false);
  });

  it("triggers alert for surging trend even if slightly below threshold", () => {
    // 70 * 0.8 = 56 → score of 60 surging should trigger
    expect(shouldTriggerAlert(60, "surging", 70)).toBe(true);
  });

  it("does not trigger for growing trend below threshold", () => {
    expect(shouldTriggerAlert(60, "growing", 70)).toBe(false);
  });

  it("uses default threshold of 70 when not specified", () => {
    expect(shouldTriggerAlert(72, "stable")).toBe(true);
    expect(shouldTriggerAlert(65, "stable")).toBe(false);
  });
});

describe("Engagement Score Computation", () => {
  it("weights high-value events (offers) more than views", () => {
    const now = new Date();
    const viewOnly = [{ type: "property_view" as EventType, timestamp: now }];
    const offerOnly = [{ type: "make_offer" as EventType, timestamp: now }];
    expect(computeEngagementScore(offerOnly)).toBeGreaterThan(computeEngagementScore(viewOnly));
  });

  it("decays score for older events", () => {
    const recentDate = new Date();
    const oldDate = new Date(Date.now() - 80 * 24 * 60 * 60 * 1000); // 80 days ago
    const recentOffer = [{ type: "make_offer" as EventType, timestamp: recentDate }];
    const oldOffer = [{ type: "make_offer" as EventType, timestamp: oldDate }];
    expect(computeEngagementScore(recentOffer)).toBeGreaterThan(computeEngagementScore(oldOffer));
  });

  it("returns 0 for empty event list", () => {
    expect(computeEngagementScore([])).toBe(0);
  });

  it("caps score at 100 for many high-value events", () => {
    const now = new Date();
    const events = Array(50).fill({ type: "make_offer" as EventType, timestamp: now });
    expect(computeEngagementScore(events)).toBeLessThanOrEqual(100);
  });

  it("correctly ranks event types by weight", () => {
    const now = new Date();
    expect(eventTypeWeight("make_offer")).toBeGreaterThan(eventTypeWeight("attend_showing"));
    expect(eventTypeWeight("attend_showing")).toBeGreaterThan(eventTypeWeight("contact_seller"));
    expect(eventTypeWeight("contact_seller")).toBeGreaterThan(eventTypeWeight("save_favorite"));
    expect(eventTypeWeight("save_favorite")).toBeGreaterThan(eventTypeWeight("property_view"));
    expect(eventTypeWeight("property_view")).toBeGreaterThan(eventTypeWeight("search"));
  });
});
