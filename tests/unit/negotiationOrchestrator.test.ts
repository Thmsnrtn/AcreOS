/**
 * T — Negotiation Orchestrator Unit Tests
 *
 * Tests core negotiation logic:
 * - Confidence score calculation
 * - Counter-offer percentage selection
 * - Tactic selection based on seller profile
 * - Auto-negotiation threshold decisions
 * - Strategy performance metrics
 */

import { describe, it, expect } from "vitest";

// ── Types mirroring NegotiationOrchestrator ───────────────────────────────────

type SellerMotivation = "distressed" | "motivated" | "neutral" | "passive";
type CommunicationStyle = "analytical" | "amiable" | "driver" | "expressive";
type IncrementStrategy = "aggressive" | "moderate" | "conservative";

interface SellerProfile {
  motivation: SellerMotivation;
  urgency: number; // 0-100
  emotionalTriggers: string[];
  communicationStyle: CommunicationStyle;
  priceFlexibility: number; // 0-100
  keyPainPoints: string[];
}

interface NegotiationContext {
  propertyId: string;
  askingPrice: number;
  marketValue: number;
  comparables: any[];
  sellerHistory: any[];
  timeOnMarket: number;
  competingOffers: number;
}

// ── Pure helpers mirroring NegotiationOrchestrator private methods ────────────

function calculateConfidence(profile: SellerProfile, context: NegotiationContext): number {
  let confidence = 50;

  if (profile.urgency > 70) confidence += 20;
  else if (profile.urgency < 30) confidence -= 10;

  if (profile.motivation === "distressed") confidence += 15;
  else if (profile.motivation === "passive") confidence -= 15;

  if (profile.priceFlexibility > 70) confidence += 15;
  else if (profile.priceFlexibility < 30) confidence -= 10;

  if (context.timeOnMarket > 90) confidence += 10;
  else if (context.timeOnMarket < 30) confidence -= 5;

  confidence -= context.competingOffers * 5;

  return Math.max(10, Math.min(95, confidence));
}

function selectOfferPercentage(profile: SellerProfile, context: NegotiationContext): number {
  let offerPercentage = 0.75;

  if (profile.motivation === "distressed" && profile.urgency > 70) {
    offerPercentage = 0.60;
  } else if (profile.motivation === "passive" || profile.urgency < 30) {
    offerPercentage = 0.85;
  }

  if (context.timeOnMarket > 90) {
    offerPercentage -= 0.05;
  } else if (context.timeOnMarket < 30) {
    offerPercentage += 0.05;
  }

  if (context.competingOffers > 2) {
    offerPercentage += 0.10;
  }

  return offerPercentage;
}

function selectTactics(profile: SellerProfile, context: NegotiationContext): string[] {
  const tactics: string[] = [];

  if (profile.motivation === "distressed") {
    tactics.push("Emphasize quick close and cash certainty");
    tactics.push("Highlight risks of waiting (tax implications, maintenance costs)");
  }

  if (profile.communicationStyle === "analytical") {
    tactics.push("Provide detailed comps and market data");
    tactics.push("Use logical argumentation with numbers");
  } else if (profile.communicationStyle === "amiable") {
    tactics.push("Build rapport and trust first");
    tactics.push("Emphasize win-win outcome");
  } else if (profile.communicationStyle === "driver") {
    tactics.push("Be direct and results-focused");
    tactics.push("Emphasize efficiency and speed");
  } else if (profile.communicationStyle === "expressive") {
    tactics.push("Use storytelling and vision");
    tactics.push("Appeal to emotions and legacy");
  }

  if (context.timeOnMarket > 60) {
    tactics.push("Reference market time concerns");
  }

  return tactics;
}

function autoNegotiateDecision(
  counterOffer: number,
  currentOffer: number,
  maxPrice: number,
  autoApproveUnder: number
): { action: "accept" | "counter" | "walkaway"; newOffer?: number } {
  if (counterOffer <= autoApproveUnder) {
    return { action: "accept" };
  }
  if (counterOffer > maxPrice) {
    return { action: "walkaway" };
  }
  const gap = counterOffer - currentOffer;
  const newOffer = currentOffer + Math.round(gap * 0.4);
  return { action: "counter", newOffer };
}

function computeStrategyPerformance(
  outcomes: { outcome: string; discountPercentage: number | null; daysToClose: number }[]
): { successRate: number; avgDiscount: number; avgDaysToClose: number; timesUsed: number } {
  const successful = outcomes.filter(o => o.outcome === "accepted");
  return {
    timesUsed: outcomes.length,
    successRate: outcomes.length > 0 ? (successful.length / outcomes.length) * 100 : 0,
    avgDiscount:
      successful.length > 0
        ? successful.reduce((s, o) => s + (o.discountPercentage ?? 0), 0) / successful.length
        : 0,
    avgDaysToClose:
      successful.length > 0
        ? successful.reduce((s, o) => s + o.daysToClose, 0) / successful.length
        : 0,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Confidence Score Calculation", () => {
  const baseContext: NegotiationContext = {
    propertyId: "p1",
    askingPrice: 100_000,
    marketValue: 90_000,
    comparables: [],
    sellerHistory: [],
    timeOnMarket: 60,
    competingOffers: 0,
  };

  it("starts at 50 and stays within [10, 95]", () => {
    const profile: SellerProfile = {
      motivation: "neutral",
      urgency: 50,
      emotionalTriggers: [],
      communicationStyle: "analytical",
      priceFlexibility: 50,
      keyPainPoints: [],
    };
    const score = calculateConfidence(profile, baseContext);
    expect(score).toBeGreaterThanOrEqual(10);
    expect(score).toBeLessThanOrEqual(95);
  });

  it("adds 20 points for urgency > 70", () => {
    const base: SellerProfile = {
      motivation: "neutral",
      urgency: 50,
      emotionalTriggers: [],
      communicationStyle: "analytical",
      priceFlexibility: 50,
      keyPainPoints: [],
    };
    const urgent = { ...base, urgency: 80 };
    expect(calculateConfidence(urgent, baseContext)).toBeGreaterThan(calculateConfidence(base, baseContext));
  });

  it("adds 15 points for distressed motivation", () => {
    const neutral: SellerProfile = {
      motivation: "neutral",
      urgency: 50,
      emotionalTriggers: [],
      communicationStyle: "analytical",
      priceFlexibility: 50,
      keyPainPoints: [],
    };
    const distressed = { ...neutral, motivation: "distressed" as const };
    expect(calculateConfidence(distressed, baseContext)).toBeGreaterThan(calculateConfidence(neutral, baseContext));
  });

  it("subtracts 15 points for passive motivation", () => {
    const neutral: SellerProfile = {
      motivation: "neutral",
      urgency: 50,
      emotionalTriggers: [],
      communicationStyle: "analytical",
      priceFlexibility: 50,
      keyPainPoints: [],
    };
    const passive = { ...neutral, motivation: "passive" as const };
    expect(calculateConfidence(passive, baseContext)).toBeLessThan(calculateConfidence(neutral, baseContext));
  });

  it("subtracts 5 points per competing offer", () => {
    const profile: SellerProfile = {
      motivation: "neutral",
      urgency: 50,
      emotionalTriggers: [],
      communicationStyle: "analytical",
      priceFlexibility: 50,
      keyPainPoints: [],
    };
    const noCompetition = calculateConfidence(profile, { ...baseContext, competingOffers: 0 });
    const threeCompetitors = calculateConfidence(profile, { ...baseContext, competingOffers: 3 });
    expect(noCompetition - threeCompetitors).toBe(15);
  });

  it("adds 10 points for time on market > 90 days", () => {
    const profile: SellerProfile = {
      motivation: "neutral",
      urgency: 50,
      emotionalTriggers: [],
      communicationStyle: "analytical",
      priceFlexibility: 50,
      keyPainPoints: [],
    };
    const fresh = calculateConfidence(profile, { ...baseContext, timeOnMarket: 20 });
    const stale = calculateConfidence(profile, { ...baseContext, timeOnMarket: 120 });
    expect(stale).toBeGreaterThan(fresh);
  });

  it("never exceeds 95", () => {
    const profile: SellerProfile = {
      motivation: "distressed",
      urgency: 100,
      emotionalTriggers: [],
      communicationStyle: "driver",
      priceFlexibility: 100,
      keyPainPoints: [],
    };
    expect(calculateConfidence(profile, { ...baseContext, timeOnMarket: 180, competingOffers: 0 })).toBeLessThanOrEqual(95);
  });

  it("never drops below 10", () => {
    const profile: SellerProfile = {
      motivation: "passive",
      urgency: 0,
      emotionalTriggers: [],
      communicationStyle: "amiable",
      priceFlexibility: 10,
      keyPainPoints: [],
    };
    expect(calculateConfidence(profile, { ...baseContext, competingOffers: 20 })).toBeGreaterThanOrEqual(10);
  });
});

describe("Offer Percentage Selection", () => {
  const baseContext: NegotiationContext = {
    propertyId: "p1",
    askingPrice: 100_000,
    marketValue: 90_000,
    comparables: [],
    sellerHistory: [],
    timeOnMarket: 60,
    competingOffers: 0,
  };

  it("defaults to 75% for neutral/motivated seller", () => {
    const profile: SellerProfile = {
      motivation: "neutral",
      urgency: 50,
      emotionalTriggers: [],
      communicationStyle: "analytical",
      priceFlexibility: 50,
      keyPainPoints: [],
    };
    expect(selectOfferPercentage(profile, baseContext)).toBeCloseTo(0.75);
  });

  it("uses 60% for distressed seller with urgency > 70", () => {
    const profile: SellerProfile = {
      motivation: "distressed",
      urgency: 80,
      emotionalTriggers: [],
      communicationStyle: "driver",
      priceFlexibility: 70,
      keyPainPoints: [],
    };
    expect(selectOfferPercentage(profile, baseContext)).toBeCloseTo(0.60);
  });

  it("uses 85% for passive seller", () => {
    const profile: SellerProfile = {
      motivation: "passive",
      urgency: 50,
      emotionalTriggers: [],
      communicationStyle: "amiable",
      priceFlexibility: 40,
      keyPainPoints: [],
    };
    expect(selectOfferPercentage(profile, baseContext)).toBeCloseTo(0.85);
  });

  it("reduces by 5% for stale listing (>90 days)", () => {
    const profile: SellerProfile = {
      motivation: "neutral",
      urgency: 50,
      emotionalTriggers: [],
      communicationStyle: "analytical",
      priceFlexibility: 50,
      keyPainPoints: [],
    };
    const fresh = selectOfferPercentage(profile, { ...baseContext, timeOnMarket: 20 });
    const stale = selectOfferPercentage(profile, { ...baseContext, timeOnMarket: 100 });
    expect(stale).toBeLessThan(fresh);
    expect(fresh - stale).toBeCloseTo(0.10); // +0.05 for fresh, -0.05 for stale
  });

  it("adds 10% for >2 competing offers", () => {
    const profile: SellerProfile = {
      motivation: "neutral",
      urgency: 50,
      emotionalTriggers: [],
      communicationStyle: "analytical",
      priceFlexibility: 50,
      keyPainPoints: [],
    };
    const noCompetition = selectOfferPercentage(profile, { ...baseContext, competingOffers: 0 });
    const competitive = selectOfferPercentage(profile, { ...baseContext, competingOffers: 3 });
    expect(competitive - noCompetition).toBeCloseTo(0.10);
  });
});

describe("Tactic Selection", () => {
  const baseContext: NegotiationContext = {
    propertyId: "p1",
    askingPrice: 100_000,
    marketValue: 90_000,
    comparables: [],
    sellerHistory: [],
    timeOnMarket: 30,
    competingOffers: 0,
  };

  it("includes cash certainty tactic for distressed sellers", () => {
    const profile: SellerProfile = {
      motivation: "distressed",
      urgency: 80,
      emotionalTriggers: [],
      communicationStyle: "driver",
      priceFlexibility: 60,
      keyPainPoints: [],
    };
    const tactics = selectTactics(profile, baseContext);
    expect(tactics.some(t => t.includes("cash certainty"))).toBe(true);
  });

  it("includes comps-based tactics for analytical communicators", () => {
    const profile: SellerProfile = {
      motivation: "neutral",
      urgency: 50,
      emotionalTriggers: [],
      communicationStyle: "analytical",
      priceFlexibility: 50,
      keyPainPoints: [],
    };
    const tactics = selectTactics(profile, baseContext);
    expect(tactics.some(t => t.includes("comps"))).toBe(true);
  });

  it("includes rapport-building for amiable communicators", () => {
    const profile: SellerProfile = {
      motivation: "neutral",
      urgency: 50,
      emotionalTriggers: [],
      communicationStyle: "amiable",
      priceFlexibility: 50,
      keyPainPoints: [],
    };
    const tactics = selectTactics(profile, baseContext);
    expect(tactics.some(t => t.includes("rapport"))).toBe(true);
  });

  it("adds market time tactic for listings over 60 days", () => {
    const profile: SellerProfile = {
      motivation: "neutral",
      urgency: 50,
      emotionalTriggers: [],
      communicationStyle: "driver",
      priceFlexibility: 50,
      keyPainPoints: [],
    };
    const tactics = selectTactics(profile, { ...baseContext, timeOnMarket: 90 });
    expect(tactics.some(t => t.includes("market time"))).toBe(true);
  });

  it("includes storytelling for expressive communicators", () => {
    const profile: SellerProfile = {
      motivation: "motivated",
      urgency: 60,
      emotionalTriggers: [],
      communicationStyle: "expressive",
      priceFlexibility: 55,
      keyPainPoints: [],
    };
    const tactics = selectTactics(profile, baseContext);
    expect(tactics.some(t => t.includes("storytelling"))).toBe(true);
  });
});

describe("Auto-Negotiation Decisions", () => {
  it("accepts when seller counter is at or below auto-approve threshold", () => {
    const result = autoNegotiateDecision(190_000, 175_000, 220_000, 195_000);
    expect(result.action).toBe("accept");
  });

  it("walks away when seller counter exceeds max price", () => {
    const result = autoNegotiateDecision(250_000, 175_000, 220_000, 195_000);
    expect(result.action).toBe("walkaway");
  });

  it("counters by bridging 40% of gap", () => {
    // current=175k, counter=230k, gap=55k, 40%=22k → new=197k
    const result = autoNegotiateDecision(230_000, 175_000, 240_000, 195_000);
    expect(result.action).toBe("counter");
    expect(result.newOffer).toBe(175_000 + Math.round(55_000 * 0.4));
  });

  it("counter never exceeds max price in normal operation", () => {
    const result = autoNegotiateDecision(215_000, 195_000, 220_000, 190_000);
    if (result.action === "counter" && result.newOffer !== undefined) {
      expect(result.newOffer).toBeLessThanOrEqual(220_000);
    }
  });
});

describe("Strategy Performance Metrics", () => {
  it("computes 100% success rate when all outcomes accepted", () => {
    const outcomes = [
      { outcome: "accepted", discountPercentage: 10, daysToClose: 20 },
      { outcome: "accepted", discountPercentage: 15, daysToClose: 25 },
    ];
    const perf = computeStrategyPerformance(outcomes);
    expect(perf.successRate).toBe(100);
    expect(perf.timesUsed).toBe(2);
  });

  it("computes 0% success rate when all outcomes rejected", () => {
    const outcomes = [
      { outcome: "rejected", discountPercentage: null, daysToClose: 0 },
      { outcome: "expired", discountPercentage: null, daysToClose: 0 },
    ];
    const perf = computeStrategyPerformance(outcomes);
    expect(perf.successRate).toBe(0);
    expect(perf.avgDiscount).toBe(0);
    expect(perf.avgDaysToClose).toBe(0);
  });

  it("computes correct avg discount across accepted outcomes", () => {
    const outcomes = [
      { outcome: "accepted", discountPercentage: 10, daysToClose: 20 },
      { outcome: "accepted", discountPercentage: 20, daysToClose: 30 },
      { outcome: "rejected", discountPercentage: null, daysToClose: 0 },
    ];
    const perf = computeStrategyPerformance(outcomes);
    expect(perf.avgDiscount).toBeCloseTo(15);
    expect(perf.successRate).toBeCloseTo(66.67, 1);
  });

  it("returns zero metrics for empty outcomes array", () => {
    const perf = computeStrategyPerformance([]);
    expect(perf.timesUsed).toBe(0);
    expect(perf.successRate).toBe(0);
  });

  it("correctly averages daysToClose for accepted outcomes only", () => {
    const outcomes = [
      { outcome: "accepted", discountPercentage: 12, daysToClose: 10 },
      { outcome: "accepted", discountPercentage: 8, daysToClose: 30 },
    ];
    const perf = computeStrategyPerformance(outcomes);
    expect(perf.avgDaysToClose).toBe(20);
  });
});
