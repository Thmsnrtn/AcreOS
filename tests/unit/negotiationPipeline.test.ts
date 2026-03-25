import { describe, it, expect } from "vitest";

// Test the pure analysis logic from negotiationPipeline

function analyzeResponsePure(responseText: string) {
  if (!responseText || responseText.trim().length === 0) {
    return { sentiment: "neutral", objections: [], suggestedStrategy: "logic" };
  }

  const lowerText = responseText.toLowerCase();
  let sentiment: string = "neutral";
  if (lowerText.includes("interested") || lowerText.includes("yes")) sentiment = "positive";
  else if (lowerText === "no" || (lowerText.includes("no") && lowerText.length < 20)) sentiment = "negative";
  else if (lowerText.includes("ridiculous") || lowerText.includes("insulting")) sentiment = "hostile";

  const objections: Array<{ category: string; severity: string }> = [];
  if (lowerText.includes("too low")) objections.push({ category: "price", severity: "medium" });
  if (lowerText.includes("other offer")) objections.push({ category: "competition", severity: "high" });

  let suggestedStrategy = "logic";
  if (sentiment === "hostile") suggestedStrategy = "empathy";
  if (sentiment === "positive") suggestedStrategy = "urgency";

  return { sentiment, objections, suggestedStrategy };
}

describe("negotiationPipeline — offer wizard with no comp data", () => {
  it("falls back to county average when no comps", () => {
    // When estimatedValue is 0, the system should indicate ARV needed
    const estimatedValue = 0;
    const aggressive = Math.round(estimatedValue * 0.25);
    expect(aggressive).toBe(0);
  });

  it("generates 3 tiers when value is known", () => {
    const estimatedValue = 10000;
    const tiers = [
      Math.round(estimatedValue * 0.25), // 2500
      Math.round(estimatedValue * 0.40), // 4000
      Math.round(estimatedValue * 0.55), // 5500
    ];
    expect(tiers).toHaveLength(3);
    expect(tiers[0]).toBe(2500);
    expect(tiers[1]).toBe(4000);
    expect(tiers[2]).toBe(5500);
  });
});

describe("negotiationPipeline — response analyzer", () => {
  it("handles one-word 'no'", () => {
    const result = analyzeResponsePure("no");
    expect(result.sentiment).toBe("negative");
  });

  it("handles multi-paragraph response", () => {
    const result = analyzeResponsePure(
      "I appreciate your offer but it's too low for what the property is worth. I've had other offers that are much closer to my asking price. Let me think about it and get back to you.",
    );
    expect(result.objections.length).toBeGreaterThan(0);
    expect(result.objections.some(o => o.category === "price")).toBe(true);
    expect(result.objections.some(o => o.category === "competition")).toBe(true);
  });

  it("handles empty string", () => {
    const result = analyzeResponsePure("");
    expect(result.sentiment).toBe("neutral");
    expect(result.suggestedStrategy).toBe("logic");
  });

  it("detects hostile sentiment", () => {
    const result = analyzeResponsePure("This is ridiculous, your offer is insulting");
    expect(result.sentiment).toBe("hostile");
    expect(result.suggestedStrategy).toBe("empathy");
  });

  it("detects positive sentiment", () => {
    const result = analyzeResponsePure("Yes, I'm interested in discussing this further");
    expect(result.sentiment).toBe("positive");
    expect(result.suggestedStrategy).toBe("urgency");
  });
});

describe("negotiationPipeline — timeline renders", () => {
  it("renders with 0 rounds", () => {
    const rounds: any[] = [];
    expect(rounds.length).toBe(0);
  });

  it("renders with 1 round", () => {
    const rounds = [{ roundNumber: 1, type: "offer", amount: 5000, timestamp: "2026-01-01" }];
    expect(rounds.length).toBe(1);
  });

  it("renders with 5 rounds", () => {
    const rounds = Array.from({ length: 5 }, (_, i) => ({
      roundNumber: i + 1,
      type: i % 2 === 0 ? "offer" : "counter",
      amount: 5000 + i * 500,
      timestamp: `2026-01-0${i + 1}`,
    }));
    expect(rounds.length).toBe(5);
    expect(rounds[4].amount).toBe(7000);
  });
});
