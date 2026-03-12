/**
 * T128 — Deal Hunter Unit Tests
 *
 * Tests deal scoring, source priority ranking, alert filtering,
 * deduplication logic, and deal opportunity classification.
 */

import { describe, it, expect } from "vitest";

// ── Pure helpers (mirroring DealHunterService logic) ─────────────────────────

type DealType = "tax_auction" | "foreclosure" | "probate" | "divorce" | "estate" | "vacant";
type OpportunityTier = "A" | "B" | "C" | "D";

interface ScrapedDealCandidate {
  parcelNumber?: string;
  address?: string;
  county: string;
  state: string;
  dealType: DealType;
  estimatedValue?: number;
  listedPrice?: number;
  daysListed?: number;
  ownerAbsentee?: boolean;
  taxDelinquent?: boolean;
  vacancyScore?: number;
}

function scoreDeal(deal: ScrapedDealCandidate): number {
  let score = 0;

  // Deal type premiums
  const typeScores: Record<DealType, number> = {
    tax_auction: 30,
    foreclosure: 25,
    probate: 20,
    divorce: 20,
    estate: 15,
    vacant: 10,
  };
  score += typeScores[deal.dealType] ?? 0;

  // Discount to value ratio
  if (deal.estimatedValue && deal.listedPrice) {
    const ratio = deal.listedPrice / deal.estimatedValue;
    if (ratio < 0.5) score += 30;
    else if (ratio < 0.7) score += 20;
    else if (ratio < 0.85) score += 10;
  }

  // Distress signals
  if (deal.ownerAbsentee) score += 10;
  if (deal.taxDelinquent) score += 15;

  // Days on market
  if (deal.daysListed !== undefined) {
    if (deal.daysListed > 180) score += 10;
    else if (deal.daysListed > 90) score += 5;
  }

  // Vacancy
  if (deal.vacancyScore !== undefined) {
    score += Math.round((deal.vacancyScore / 100) * 10);
  }

  return Math.min(100, score);
}

function classifyOpportunity(score: number): OpportunityTier {
  if (score >= 70) return "A";
  if (score >= 50) return "B";
  if (score >= 30) return "C";
  return "D";
}

function deduplicateDeals(
  deals: Array<{ parcelNumber?: string; address?: string; state: string; county: string }>
): typeof deals {
  const seen = new Set<string>();
  return deals.filter(deal => {
    const key = deal.parcelNumber
      ? `${deal.state}-${deal.county}-${deal.parcelNumber}`
      : `${deal.state}-${deal.county}-${deal.address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rankSources(
  sources: Array<{ id: number; priority: number; consecutiveFailures: number; isActive: boolean }>
): typeof sources {
  return sources
    .filter(s => s.isActive && s.consecutiveFailures < 5)
    .sort((a, b) => b.priority - a.priority);
}

function shouldProcessDeal(
  deal: ScrapedDealCandidate,
  minScore: number = 30
): boolean {
  return scoreDeal(deal) >= minScore;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Deal Scoring", () => {
  it("gives highest score to tax auction with deep discount", () => {
    const deal: ScrapedDealCandidate = {
      county: "Travis",
      state: "TX",
      dealType: "tax_auction",
      estimatedValue: 100_000,
      listedPrice: 40_000, // 40% of value
      taxDelinquent: true,
      ownerAbsentee: true,
    };
    expect(scoreDeal(deal)).toBeGreaterThanOrEqual(70);
  });

  it("base score for deal type is correct", () => {
    const base = (type: DealType) =>
      scoreDeal({ county: "X", state: "TX", dealType: type });
    expect(base("tax_auction")).toBeGreaterThan(base("vacant"));
    expect(base("foreclosure")).toBeGreaterThan(base("estate"));
  });

  it("adds bonus for below-50% price-to-value ratio", () => {
    const deep: ScrapedDealCandidate = {
      county: "X",
      state: "TX",
      dealType: "estate",
      estimatedValue: 100_000,
      listedPrice: 45_000,
    };
    const fair: ScrapedDealCandidate = {
      ...deep,
      listedPrice: 90_000,
    };
    expect(scoreDeal(deep)).toBeGreaterThan(scoreDeal(fair));
  });

  it("adds bonus for tax delinquency", () => {
    const base: ScrapedDealCandidate = { county: "X", state: "TX", dealType: "vacant" };
    const delinquent = { ...base, taxDelinquent: true };
    expect(scoreDeal(delinquent)).toBeGreaterThan(scoreDeal(base));
  });

  it("adds bonus for absentee owner", () => {
    const base: ScrapedDealCandidate = { county: "X", state: "TX", dealType: "vacant" };
    const absentee = { ...base, ownerAbsentee: true };
    expect(scoreDeal(absentee)).toBeGreaterThan(scoreDeal(base));
  });

  it("adds bonus for long listing duration (>180 days)", () => {
    const fresh: ScrapedDealCandidate = { county: "X", state: "TX", dealType: "estate", daysListed: 10 };
    const stale = { ...fresh, daysListed: 200 };
    expect(scoreDeal(stale)).toBeGreaterThan(scoreDeal(fresh));
  });

  it("never exceeds 100", () => {
    const maxDeal: ScrapedDealCandidate = {
      county: "X",
      state: "TX",
      dealType: "tax_auction",
      estimatedValue: 100_000,
      listedPrice: 10_000,
      taxDelinquent: true,
      ownerAbsentee: true,
      daysListed: 365,
      vacancyScore: 100,
    };
    expect(scoreDeal(maxDeal)).toBeLessThanOrEqual(100);
  });
});

describe("Opportunity Classification", () => {
  it("classifies 70+ as A (hot opportunity)", () => {
    expect(classifyOpportunity(70)).toBe("A");
    expect(classifyOpportunity(100)).toBe("A");
  });

  it("classifies 50–69 as B", () => {
    expect(classifyOpportunity(50)).toBe("B");
    expect(classifyOpportunity(69)).toBe("B");
  });

  it("classifies 30–49 as C", () => {
    expect(classifyOpportunity(30)).toBe("C");
    expect(classifyOpportunity(49)).toBe("C");
  });

  it("classifies below 30 as D", () => {
    expect(classifyOpportunity(0)).toBe("D");
    expect(classifyOpportunity(29)).toBe("D");
  });
});

describe("Deal Deduplication", () => {
  it("removes duplicate deals by parcel number", () => {
    const deals = [
      { parcelNumber: "001-234", state: "TX", county: "Travis", address: "123 Main" },
      { parcelNumber: "001-234", state: "TX", county: "Travis", address: "123 Main St" },
      { parcelNumber: "005-678", state: "TX", county: "Travis", address: "456 Oak" },
    ];
    const unique = deduplicateDeals(deals);
    expect(unique).toHaveLength(2);
  });

  it("deduplicates by address when no parcel number", () => {
    const deals = [
      { state: "TX", county: "Travis", address: "123 Main" },
      { state: "TX", county: "Travis", address: "123 Main" },
      { state: "TX", county: "Travis", address: "456 Oak" },
    ];
    const unique = deduplicateDeals(deals);
    expect(unique).toHaveLength(2);
  });

  it("keeps deals from different counties with same parcel", () => {
    const deals = [
      { parcelNumber: "001", state: "TX", county: "Travis", address: "A" },
      { parcelNumber: "001", state: "TX", county: "Hays", address: "B" },
    ];
    const unique = deduplicateDeals(deals);
    expect(unique).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(deduplicateDeals([])).toHaveLength(0);
  });

  it("preserves all unique deals", () => {
    const deals = [
      { parcelNumber: "001", state: "TX", county: "Travis", address: "A" },
      { parcelNumber: "002", state: "TX", county: "Travis", address: "B" },
      { parcelNumber: "003", state: "FL", county: "Lake", address: "C" },
    ];
    expect(deduplicateDeals(deals)).toHaveLength(3);
  });
});

describe("Source Prioritization", () => {
  const sources = [
    { id: 1, priority: 50, consecutiveFailures: 0, isActive: true },
    { id: 2, priority: 90, consecutiveFailures: 0, isActive: true },
    { id: 3, priority: 70, consecutiveFailures: 2, isActive: true },
    { id: 4, priority: 80, consecutiveFailures: 6, isActive: true },  // too many failures
    { id: 5, priority: 100, consecutiveFailures: 0, isActive: false }, // inactive
  ];

  it("filters inactive sources", () => {
    const ranked = rankSources(sources);
    expect(ranked.map(s => s.id)).not.toContain(5);
  });

  it("filters sources with too many consecutive failures (>=5)", () => {
    const ranked = rankSources(sources);
    expect(ranked.map(s => s.id)).not.toContain(4);
  });

  it("sorts by priority descending", () => {
    const ranked = rankSources(sources);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].priority).toBeGreaterThanOrEqual(ranked[i].priority);
    }
  });

  it("includes sources with some failures if under threshold", () => {
    const ranked = rankSources(sources);
    expect(ranked.map(s => s.id)).toContain(3); // 2 failures < 5
  });
});

describe("Deal Processing Gate", () => {
  it("processes deals that meet minimum score", () => {
    const deal: ScrapedDealCandidate = {
      county: "X",
      state: "TX",
      dealType: "tax_auction",
      taxDelinquent: true,
    };
    expect(shouldProcessDeal(deal, 30)).toBe(true);
  });

  it("rejects deals below minimum score", () => {
    const deal: ScrapedDealCandidate = {
      county: "X",
      state: "TX",
      dealType: "vacant",
    };
    // vacant = 10 points, should not reach 30
    expect(shouldProcessDeal(deal, 30)).toBe(false);
  });
});
