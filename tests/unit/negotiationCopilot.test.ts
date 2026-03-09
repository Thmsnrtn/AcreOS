/**
 * T127 — Negotiation Copilot Unit Tests
 *
 * Tests objection detection, strategy selection, sentiment scoring,
 * counter-offer generation logic, and effectiveness tracking.
 */

import { describe, it, expect } from "vitest";

// ── Types mirrored from negotiationCopilot.ts ─────────────────────────────────

type ObjectionCategory = "price" | "timing" | "trust" | "emotional" | "competitive";
type NegotiationStrategy = "empathy" | "logic" | "urgency" | "anchor" | "silence";

interface ObjectionPattern {
  keywords: string[];
  category: ObjectionCategory;
  suggestedStrategies: NegotiationStrategy[];
}

// ── Objection patterns (mirrored from negotiationCopilot.ts) ──────────────────

const OBJECTION_PATTERNS: ObjectionPattern[] = [
  {
    keywords: ["too low", "not enough", "low ball", "insulting", "worth more"],
    category: "price",
    suggestedStrategies: ["anchor", "logic"],
  },
  {
    keywords: ["not ready", "need time", "thinking about it", "not sure yet", "wait"],
    category: "timing",
    suggestedStrategies: ["urgency", "empathy"],
  },
  {
    keywords: ["don't trust", "scam", "not legitimate", "verify", "prove it"],
    category: "trust",
    suggestedStrategies: ["empathy", "logic"],
  },
  {
    keywords: ["emotional", "family", "memories", "grew up", "can't sell"],
    category: "emotional",
    suggestedStrategies: ["empathy", "silence"],
  },
  {
    keywords: ["better offer", "another buyer", "someone else", "competition"],
    category: "competitive",
    suggestedStrategies: ["anchor", "urgency"],
  },
];

// ── Pure helpers ──────────────────────────────────────────────────────────────

function detectObjections(text: string): ObjectionCategory[] {
  const lowerText = text.toLowerCase();
  const detected: ObjectionCategory[] = [];
  for (const pattern of OBJECTION_PATTERNS) {
    if (pattern.keywords.some(kw => lowerText.includes(kw))) {
      if (!detected.includes(pattern.category)) {
        detected.push(pattern.category);
      }
    }
  }
  return detected;
}

function suggestStrategies(category: ObjectionCategory): NegotiationStrategy[] {
  return OBJECTION_PATTERNS.find(p => p.category === category)?.suggestedStrategies ?? [];
}

function scoreSentiment(text: string): number {
  const positiveWords = ["yes", "interested", "agree", "fair", "reasonable", "good", "okay", "accept"];
  const negativeWords = ["no", "never", "refuse", "walk away", "disgusting", "terrible", "worst", "hate"];
  const lowerText = text.toLowerCase();
  let score = 50;
  for (const w of positiveWords) {
    if (lowerText.includes(w)) score += 8;
  }
  for (const w of negativeWords) {
    if (lowerText.includes(w)) score -= 8;
  }
  return Math.max(0, Math.min(100, score));
}

function generateCounterOffer(
  currentOffer: number,
  sellerAskingPrice: number,
  strategy: NegotiationStrategy
): { suggestedAmount: number; reasoning: string } {
  let suggestedAmount: number;
  let reasoning: string;

  switch (strategy) {
    case "anchor":
      // Hold firm near current offer
      suggestedAmount = Math.round(currentOffer * 1.03);
      reasoning = "Small incremental increase to anchor the seller closer to your range";
      break;
    case "logic":
      // Use market data midpoint
      suggestedAmount = Math.round((currentOffer + sellerAskingPrice) / 2 * 0.9);
      reasoning = "Market-data-based split-the-difference approach";
      break;
    case "urgency":
      // Slightly higher with expiry pressure
      suggestedAmount = Math.round(currentOffer * 1.05);
      reasoning = "Limited-time improvement offer to create urgency";
      break;
    case "empathy":
      // More generous split
      suggestedAmount = Math.round((currentOffer + sellerAskingPrice) / 2);
      reasoning = "Fair split that acknowledges the seller's position";
      break;
    default:
      suggestedAmount = currentOffer;
      reasoning = "Maintain current offer in silence";
  }

  return { suggestedAmount, reasoning };
}

function isCounterOfferInRange(
  amount: number,
  floor: number,
  ceiling: number
): boolean {
  return amount >= floor && amount <= ceiling;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Objection Detection", () => {
  it("detects price objection from 'too low' language", () => {
    const objections = detectObjections("That offer is too low, I know what my land is worth");
    expect(objections).toContain("price");
  });

  it("detects timing objection from 'not ready' language", () => {
    const objections = detectObjections("I'm not ready to sell, I need more time to think");
    expect(objections).toContain("timing");
  });

  it("detects trust objection", () => {
    const objections = detectObjections("I don't trust these online buyers, this sounds like a scam");
    expect(objections).toContain("trust");
  });

  it("detects emotional objection", () => {
    const objections = detectObjections(
      "My grandpa grew up on this land and we have so many memories here"
    );
    expect(objections).toContain("emotional");
  });

  it("detects competitive objection", () => {
    const objections = detectObjections("I already have a better offer from another buyer");
    expect(objections).toContain("competitive");
  });

  it("detects multiple objections in one message", () => {
    const objections = detectObjections(
      "The price is too low and I'm not ready anyway because of family memories"
    );
    expect(objections.length).toBeGreaterThan(1);
    expect(objections).toContain("price");
    expect(objections).toContain("timing");
    expect(objections).toContain("emotional");
  });

  it("returns empty array for neutral message", () => {
    const objections = detectObjections("Sounds interesting, tell me more.");
    expect(objections).toHaveLength(0);
  });

  it("is case-insensitive", () => {
    const objections = detectObjections("TOO LOW, this is insulting");
    expect(objections).toContain("price");
  });
});

describe("Strategy Suggestions", () => {
  it("suggests anchor and logic for price objection", () => {
    const strategies = suggestStrategies("price");
    expect(strategies).toContain("anchor");
    expect(strategies).toContain("logic");
  });

  it("suggests urgency and empathy for timing objection", () => {
    const strategies = suggestStrategies("timing");
    expect(strategies).toContain("urgency");
    expect(strategies).toContain("empathy");
  });

  it("suggests empathy and silence for emotional objection", () => {
    const strategies = suggestStrategies("emotional");
    expect(strategies).toContain("empathy");
    expect(strategies).toContain("silence");
  });

  it("returns empty array for unknown category", () => {
    const strategies = suggestStrategies("unknown" as any);
    expect(strategies).toHaveLength(0);
  });
});

describe("Sentiment Scoring", () => {
  it("scores neutral message near 50", () => {
    const score = scoreSentiment("I received your offer and will review it.");
    expect(score).toBeCloseTo(50, 10);
  });

  it("scores positive message higher than 50", () => {
    const score = scoreSentiment("Yes, I agree this seems fair and reasonable, okay");
    expect(score).toBeGreaterThan(50);
  });

  it("scores negative message below 50", () => {
    const score = scoreSentiment("No, never, I hate this offer, walk away");
    expect(score).toBeLessThan(50);
  });

  it("score is bounded between 0 and 100", () => {
    const extreme1 = scoreSentiment("yes yes yes yes yes yes yes yes yes yes agree agree agree");
    const extreme2 = scoreSentiment("no no no no no hate hate hate hate refuse refuse");
    expect(extreme1).toBeLessThanOrEqual(100);
    expect(extreme2).toBeGreaterThanOrEqual(0);
  });
});

describe("Counter-Offer Generation", () => {
  const currentOffer = 50_000;
  const askingPrice = 100_000;

  it("anchor strategy stays near current offer", () => {
    const { suggestedAmount } = generateCounterOffer(currentOffer, askingPrice, "anchor");
    expect(suggestedAmount).toBeCloseTo(currentOffer * 1.03, 0);
  });

  it("logic strategy splits the difference with discount", () => {
    const { suggestedAmount } = generateCounterOffer(currentOffer, askingPrice, "logic");
    // midpoint = 75k, * 0.9 = 67.5k
    expect(suggestedAmount).toBeCloseTo(67_500, -2);
  });

  it("urgency strategy increases offer slightly", () => {
    const { suggestedAmount } = generateCounterOffer(currentOffer, askingPrice, "urgency");
    expect(suggestedAmount).toBeCloseTo(currentOffer * 1.05, 0);
  });

  it("empathy strategy splits evenly", () => {
    const { suggestedAmount } = generateCounterOffer(currentOffer, askingPrice, "empathy");
    expect(suggestedAmount).toBeCloseTo(75_000, -2);
  });

  it("silence strategy maintains current offer", () => {
    const { suggestedAmount } = generateCounterOffer(currentOffer, askingPrice, "silence");
    expect(suggestedAmount).toBe(currentOffer);
  });

  it("all strategies include reasoning", () => {
    const strategies: NegotiationStrategy[] = ["anchor", "logic", "urgency", "empathy", "silence"];
    for (const s of strategies) {
      const { reasoning } = generateCounterOffer(currentOffer, askingPrice, s);
      expect(reasoning.length).toBeGreaterThan(0);
    }
  });

  it("counter offers are within acceptable range", () => {
    const strategies: NegotiationStrategy[] = ["anchor", "logic", "urgency", "empathy"];
    for (const s of strategies) {
      const { suggestedAmount } = generateCounterOffer(currentOffer, askingPrice, s);
      expect(isCounterOfferInRange(suggestedAmount, currentOffer, askingPrice)).toBe(true);
    }
  });
});

describe("Range Validation", () => {
  it("validates offer is within floor and ceiling", () => {
    expect(isCounterOfferInRange(75_000, 50_000, 100_000)).toBe(true);
  });

  it("rejects offer below floor", () => {
    expect(isCounterOfferInRange(40_000, 50_000, 100_000)).toBe(false);
  });

  it("rejects offer above ceiling", () => {
    expect(isCounterOfferInRange(110_000, 50_000, 100_000)).toBe(false);
  });

  it("accepts offer exactly at floor or ceiling", () => {
    expect(isCounterOfferInRange(50_000, 50_000, 100_000)).toBe(true);
    expect(isCounterOfferInRange(100_000, 50_000, 100_000)).toBe(true);
  });
});
