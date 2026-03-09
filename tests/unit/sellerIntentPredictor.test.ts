/**
 * T129 — Seller Intent Predictor Unit Tests
 *
 * Tests intent signal detection, score composition,
 * classification of intent levels, and urgency calculation.
 */

import { describe, it, expect } from "vitest";

// ── Types ─────────────────────────────────────────────────────────────────────

type IntentLevel = "hot" | "warm" | "cool" | "cold";

interface IntentSignals {
  hasRecentEnquiry?: boolean;     // Reached out in last 30 days
  hasCallBack?: boolean;          // Asked for a call back
  mentionedTimeline?: boolean;    // Mentioned wanting to sell by a date
  mentionedFinancialNeed?: boolean; // Mentioned needing cash, debt, etc.
  hasOpenedEmails?: boolean;      // Has opened multiple email campaigns
  isAbsenteeOwner?: boolean;      // Does not live on the property
  propertyTaxDelinquent?: boolean;
  vacantLand?: boolean;
  inheritedProperty?: boolean;
  probateRelated?: boolean;
  divorceRelated?: boolean;
  longTimeOwner?: boolean;        // Owned 20+ years
  priceDropAccepted?: boolean;    // Previously accepted a price reduction
  multipleTouchpoints?: boolean;  // 3+ interactions
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function calcIntentScore(signals: IntentSignals): number {
  let score = 0;

  // High-value signals
  if (signals.hasRecentEnquiry) score += 25;
  if (signals.hasCallBack) score += 20;
  if (signals.mentionedTimeline) score += 20;
  if (signals.mentionedFinancialNeed) score += 20;
  if (signals.priceDropAccepted) score += 15;
  if (signals.divorceRelated) score += 15;
  if (signals.probateRelated) score += 15;

  // Medium-value signals
  if (signals.hasOpenedEmails) score += 10;
  if (signals.isAbsenteeOwner) score += 10;
  if (signals.propertyTaxDelinquent) score += 10;
  if (signals.inheritedProperty) score += 10;
  if (signals.multipleTouchpoints) score += 10;

  // Low-value signals
  if (signals.vacantLand) score += 5;
  if (signals.longTimeOwner) score += 5;

  return Math.min(100, score);
}

function classifyIntentLevel(score: number): IntentLevel {
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  if (score >= 20) return "cool";
  return "cold";
}

function calcUrgencyScore(signals: IntentSignals): number {
  let urgency = 0;
  if (signals.mentionedTimeline) urgency += 40;
  if (signals.mentionedFinancialNeed) urgency += 35;
  if (signals.propertyTaxDelinquent) urgency += 25;
  if (signals.divorceRelated) urgency += 20;
  if (signals.probateRelated) urgency += 20;
  return Math.min(100, urgency);
}

function shouldPrioritizeOutreach(
  score: number,
  urgency: number,
  daysSinceLastContact: number
): boolean {
  // Prioritize if: hot/warm + high urgency, or overdue contact
  if (score >= 70 && urgency >= 50) return true;
  if (score >= 40 && daysSinceLastContact >= 7) return true;
  if (urgency >= 80) return true;
  return false;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Intent Score Calculation", () => {
  it("returns 0 for seller with no positive signals", () => {
    expect(calcIntentScore({})).toBe(0);
  });

  it("gives maximum weight to recent enquiry (25 pts)", () => {
    expect(calcIntentScore({ hasRecentEnquiry: true })).toBe(25);
  });

  it("accumulates multiple signals correctly", () => {
    const score = calcIntentScore({
      hasRecentEnquiry: true,    // 25
      hasCallBack: true,          // 20
      mentionedTimeline: true,    // 20
    });
    expect(score).toBe(65);
  });

  it("caps score at 100", () => {
    const allSignals: IntentSignals = {
      hasRecentEnquiry: true,
      hasCallBack: true,
      mentionedTimeline: true,
      mentionedFinancialNeed: true,
      priceDropAccepted: true,
      divorceRelated: true,
      probateRelated: true,
      hasOpenedEmails: true,
      isAbsenteeOwner: true,
      propertyTaxDelinquent: true,
      inheritedProperty: true,
      multipleTouchpoints: true,
      vacantLand: true,
      longTimeOwner: true,
    };
    expect(calcIntentScore(allSignals)).toBe(100);
  });

  it("classifies correctly across all levels", () => {
    const highScore = calcIntentScore({
      hasRecentEnquiry: true,
      hasCallBack: true,
      mentionedTimeline: true,
    });
    expect(highScore).toBe(65);
    expect(classifyIntentLevel(65)).toBe("warm");
  });
});

describe("Intent Level Classification", () => {
  it("classifies 70+ as hot", () => {
    expect(classifyIntentLevel(70)).toBe("hot");
    expect(classifyIntentLevel(100)).toBe("hot");
  });

  it("classifies 40–69 as warm", () => {
    expect(classifyIntentLevel(40)).toBe("warm");
    expect(classifyIntentLevel(69)).toBe("warm");
  });

  it("classifies 20–39 as cool", () => {
    expect(classifyIntentLevel(20)).toBe("cool");
    expect(classifyIntentLevel(39)).toBe("cool");
  });

  it("classifies below 20 as cold", () => {
    expect(classifyIntentLevel(0)).toBe("cold");
    expect(classifyIntentLevel(19)).toBe("cold");
  });
});

describe("Urgency Score", () => {
  it("returns 0 for no urgency signals", () => {
    expect(calcUrgencyScore({})).toBe(0);
  });

  it("gives 40 points for mentioned timeline", () => {
    expect(calcUrgencyScore({ mentionedTimeline: true })).toBe(40);
  });

  it("gives 35 points for financial need", () => {
    expect(calcUrgencyScore({ mentionedFinancialNeed: true })).toBe(35);
  });

  it("combines multiple urgency signals", () => {
    const urgency = calcUrgencyScore({
      mentionedTimeline: true,     // 40
      mentionedFinancialNeed: true, // 35
      propertyTaxDelinquent: true, // 25
    });
    expect(urgency).toBe(100); // Capped at 100
  });

  it("caps urgency at 100", () => {
    const urgency = calcUrgencyScore({
      mentionedTimeline: true,
      mentionedFinancialNeed: true,
      propertyTaxDelinquent: true,
      divorceRelated: true,
      probateRelated: true,
    });
    expect(urgency).toBe(100);
  });
});

describe("Outreach Prioritization", () => {
  it("prioritizes hot seller with high urgency", () => {
    expect(shouldPrioritizeOutreach(75, 55, 0)).toBe(true);
  });

  it("prioritizes warm seller overdue for contact", () => {
    expect(shouldPrioritizeOutreach(50, 20, 10)).toBe(true);
  });

  it("prioritizes very urgent seller regardless of score", () => {
    expect(shouldPrioritizeOutreach(30, 85, 0)).toBe(true);
  });

  it("does NOT prioritize cold seller with no urgency", () => {
    expect(shouldPrioritizeOutreach(10, 10, 3)).toBe(false);
  });

  it("does NOT prioritize warm seller contacted recently with low urgency", () => {
    expect(shouldPrioritizeOutreach(45, 20, 2)).toBe(false);
  });
});

describe("Signal Weight Ordering", () => {
  it("hasRecentEnquiry outweighs isAbsenteeOwner", () => {
    const enquiry = calcIntentScore({ hasRecentEnquiry: true });
    const absentee = calcIntentScore({ isAbsenteeOwner: true });
    expect(enquiry).toBeGreaterThan(absentee);
  });

  it("financial need outweighs vacant land", () => {
    const financial = calcIntentScore({ mentionedFinancialNeed: true });
    const vacant = calcIntentScore({ vacantLand: true });
    expect(financial).toBeGreaterThan(vacant);
  });

  it("divorce-related outweighs long-time owner", () => {
    const divorce = calcIntentScore({ divorceRelated: true });
    const longTime = calcIntentScore({ longTimeOwner: true });
    expect(divorce).toBeGreaterThan(longTime);
  });
});
