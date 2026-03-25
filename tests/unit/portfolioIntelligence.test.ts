import { describe, it, expect } from "vitest";

// Pure logic extracted from portfolioIntelligence.ts

interface HealthDimension {
  label: string;
  score: number;
  weight: number;
}

function calculateOverallScore(dimensions: HealthDimension[]): number {
  return Math.round(dimensions.reduce((sum, d) => sum + d.score * d.weight, 0));
}

function calculateNoteHealth(active: number, delinquent: number, defaulted: number): number {
  const total = active + delinquent + defaulted;
  if (total === 0) return 50;
  const collectionRate = (active / total) * 100;
  let score = collectionRate;
  score -= (delinquent / total) * 100 * 0.5;
  score -= (defaulted / total) * 100 * 2;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function calculateAppreciation(totalCostBasis: number, totalCurrentValue: number): number {
  if (totalCostBasis <= 0) return 50;
  return Math.min(100, Math.max(0, Math.round(((totalCurrentValue - totalCostBasis) / totalCostBasis) * 100 + 50)));
}

function calculateDiversification(countyCount: number, typeCount: number, maxConcentration: number): number {
  let score = 0;
  if (countyCount >= 5) score += 40;
  else if (countyCount >= 3) score += 30;
  else if (countyCount >= 1) score += 15;

  if (typeCount >= 3) score += 30;
  else if (typeCount >= 2) score += 20;
  else score += 10;

  if (maxConcentration < 0.5) score += 30;
  else if (maxConcentration < 0.75) score += 15;

  return Math.min(100, score);
}

function classifyOutcome(roi: number): string {
  if (roi >= 50) return "strong_gain";
  if (roi >= 0) return "gain";
  if (roi >= -20) return "loss";
  return "significant_loss";
}

function shouldShowTaxBanner(): boolean {
  const month = new Date().getMonth();
  return month >= 9; // Oct-Dec
}

function identifyTaxHarvestCandidates(
  properties: { id: number; cost: number; current: number }[],
): { id: number; loss: number }[] {
  return properties
    .filter((p) => p.current < p.cost && p.cost > 0)
    .map((p) => ({ id: p.id, loss: p.cost - p.current }))
    .sort((a, b) => b.loss - a.loss);
}

function identify1031Candidates(
  properties: { id: number; cost: number; current: number }[],
): { id: number; gain: number; appreciationPct: number }[] {
  return properties
    .filter((p) => p.current > p.cost * 1.5 && p.cost > 0)
    .map((p) => ({
      id: p.id,
      gain: p.current - p.cost,
      appreciationPct: Math.round(((p.current - p.cost) / p.cost) * 100),
    }))
    .sort((a, b) => b.gain - a.gain);
}

describe("portfolioIntelligence — health score calculation", () => {
  it("calculates weighted overall score", () => {
    const dimensions: HealthDimension[] = [
      { label: "Notes", score: 80, weight: 0.30 },
      { label: "Appreciation", score: 70, weight: 0.25 },
      { label: "Diversification", score: 60, weight: 0.20 },
      { label: "Cash Flow", score: 90, weight: 0.25 },
    ];
    const score = calculateOverallScore(dimensions);
    // 80*0.3 + 70*0.25 + 60*0.2 + 90*0.25 = 24 + 17.5 + 12 + 22.5 = 76
    expect(score).toBe(76);
  });

  it("all 100s → 100", () => {
    const dimensions: HealthDimension[] = [
      { label: "A", score: 100, weight: 0.30 },
      { label: "B", score: 100, weight: 0.25 },
      { label: "C", score: 100, weight: 0.20 },
      { label: "D", score: 100, weight: 0.25 },
    ];
    expect(calculateOverallScore(dimensions)).toBe(100);
  });

  it("all 0s → 0", () => {
    const dimensions: HealthDimension[] = [
      { label: "A", score: 0, weight: 0.30 },
      { label: "B", score: 0, weight: 0.25 },
      { label: "C", score: 0, weight: 0.20 },
      { label: "D", score: 0, weight: 0.25 },
    ];
    expect(calculateOverallScore(dimensions)).toBe(0);
  });
});

describe("portfolioIntelligence — note health", () => {
  it("all active → high score", () => {
    expect(calculateNoteHealth(10, 0, 0)).toBe(100);
  });

  it("no notes → default 50", () => {
    expect(calculateNoteHealth(0, 0, 0)).toBe(50);
  });

  it("some delinquent → reduced score", () => {
    const score = calculateNoteHealth(8, 2, 0);
    expect(score).toBeLessThan(100);
    expect(score).toBeGreaterThan(50);
  });

  it("defaults severely penalized", () => {
    const withDefault = calculateNoteHealth(7, 2, 1);
    const withoutDefault = calculateNoteHealth(7, 3, 0);
    expect(withDefault).toBeLessThan(withoutDefault);
  });

  it("score clamped to 0-100", () => {
    expect(calculateNoteHealth(0, 0, 10)).toBe(0);
    expect(calculateNoteHealth(100, 0, 0)).toBe(100);
  });
});

describe("portfolioIntelligence — appreciation", () => {
  it("no cost basis → default 50", () => {
    expect(calculateAppreciation(0, 100000)).toBe(50);
  });

  it("doubled value → high score", () => {
    const score = calculateAppreciation(100000, 200000);
    expect(score).toBeGreaterThan(80);
  });

  it("depreciated → below 50", () => {
    const score = calculateAppreciation(100000, 60000);
    expect(score).toBeLessThan(50);
  });

  it("clamped to 0-100", () => {
    expect(calculateAppreciation(100, 1000000)).toBeLessThanOrEqual(100);
    expect(calculateAppreciation(100000, 1)).toBeGreaterThanOrEqual(0);
  });
});

describe("portfolioIntelligence — diversification", () => {
  it("5+ counties, 3+ types, low concentration → max score", () => {
    const score = calculateDiversification(5, 3, 0.3);
    expect(score).toBe(100);
  });

  it("1 county, 1 type, full concentration → low score", () => {
    const score = calculateDiversification(1, 1, 1.0);
    expect(score).toBe(25); // 15 + 10 + 0
  });

  it("3 counties, 2 types, moderate concentration → mid score", () => {
    const score = calculateDiversification(3, 2, 0.6);
    expect(score).toBe(65); // 30 + 20 + 15
  });
});

describe("portfolioIntelligence — tax harvest candidates", () => {
  it("identifies properties below cost basis", () => {
    const candidates = identifyTaxHarvestCandidates([
      { id: 1, cost: 50000, current: 40000 },
      { id: 2, cost: 80000, current: 90000 },
      { id: 3, cost: 30000, current: 20000 },
    ]);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].id).toBe(1); // $10k loss (sorted by largest)
    expect(candidates[1].id).toBe(3); // $10k loss
  });

  it("no losers → empty", () => {
    const candidates = identifyTaxHarvestCandidates([
      { id: 1, cost: 50000, current: 60000 },
    ]);
    expect(candidates).toHaveLength(0);
  });

  it("zero cost basis excluded", () => {
    const candidates = identifyTaxHarvestCandidates([
      { id: 1, cost: 0, current: 10000 },
    ]);
    expect(candidates).toHaveLength(0);
  });
});

describe("portfolioIntelligence — 1031 exchange candidates", () => {
  it("identifies properties with >50% appreciation", () => {
    const candidates = identify1031Candidates([
      { id: 1, cost: 50000, current: 80000 }, // 60%, gain=$30k → qualifies
      { id: 2, cost: 80000, current: 90000 }, // 12.5% → no
      { id: 3, cost: 20000, current: 45000 }, // 125%, gain=$25k → qualifies
    ]);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].id).toBe(1); // largest gain ($30k)
    expect(candidates[1].id).toBe(3);
    expect(candidates[1].appreciationPct).toBe(125);
  });

  it("zero cost properties excluded", () => {
    const candidates = identify1031Candidates([
      { id: 1, cost: 0, current: 100000 },
    ]);
    expect(candidates).toHaveLength(0);
  });
});
