import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Pure logic extracted from dealPatternCloning.ts for unit testing
// ---------------------------------------------------------------------------

function normalizedEuclidean(a: number, b: number, maxRange: number): number {
  const distance = Math.abs(a - b) / maxRange;
  return Math.max(0, 1 - distance);
}

function jaccardSimilarity(setA: string[], setB: string[]): number {
  const a = setA.map((s) => s.toLowerCase());
  const b = setB.map((s) => s.toLowerCase());
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  let intersection = 0;
  const bSet = new Set(b);
  for (const item of a) {
    if (bSet.has(item)) intersection++;
  }
  return intersection / union.size;
}

function detectSellerType(firstName: string, lastName: string): string {
  const name = `${firstName} ${lastName}`.toUpperCase();
  const corporateIndicators = ["LLC", "INC", "CORP", "LP", "LLP", "TRUST", "ESTATE", "COMPANY"];
  if (corporateIndicators.some((ind) => name.includes(ind))) {
    if (name.includes("ESTATE") || name.includes("TRUST")) return "estate";
    return "corporate";
  }
  return "individual";
}

interface PropertyFingerprint {
  acreage: number;
  county: string;
  state: string;
  zoning?: string;
  terrain?: string;
  roadAccess?: string;
  utilities?: string[];
}

interface PatternFingerprint {
  property: PropertyFingerprint;
  deal: { type: string; offerToAskRatio?: number; daysToClose?: number; finalMargin?: number };
  seller?: { type?: string; motivation?: string[] };
  market?: { pricePerAcre: number; marketTrend?: string; competitionLevel?: string };
}

const DEFAULT_WEIGHTS = { property: 0.35, deal: 0.25, seller: 0.15, market: 0.15, geographic: 0.10 };

function calculatePropertySimilarity(target: PropertyFingerprint, pattern: PropertyFingerprint): number {
  let score = 0;
  let factors = 0;
  score += normalizedEuclidean(target.acreage, pattern.acreage, 1000);
  factors++;
  if (target.zoning && pattern.zoning) { score += target.zoning === pattern.zoning ? 1 : 0.3; factors++; }
  if (target.terrain && pattern.terrain) { score += target.terrain === pattern.terrain ? 1 : 0.5; factors++; }
  if (target.roadAccess && pattern.roadAccess) { score += target.roadAccess === pattern.roadAccess ? 1 : 0.5; factors++; }
  if (target.utilities && pattern.utilities) { score += jaccardSimilarity(target.utilities, pattern.utilities); factors++; }
  return factors > 0 ? score / factors : 0;
}

function calculateGeographicBonus(target: PropertyFingerprint, pattern: PropertyFingerprint): number {
  if (target.county === pattern.county && target.state === pattern.state) return 1;
  if (target.state === pattern.state) return 0.5;
  return 0;
}

function calculateOverallSimilarity(target: PatternFingerprint, pattern: PatternFingerprint): number {
  const propSim = calculatePropertySimilarity(target.property, pattern.property);
  const geoBonus = calculateGeographicBonus(target.property, pattern.property);
  // Simplified: deal, seller, market scored inline
  let dealSim = target.deal.type === pattern.deal.type ? 1 : 0.3;
  const sellerSim = 0.5; // default when no seller
  const marketSim = target.market && pattern.market
    ? normalizedEuclidean(target.market.pricePerAcre, pattern.market.pricePerAcre, 50000)
    : 0.5;

  const overall =
    propSim * DEFAULT_WEIGHTS.property +
    dealSim * DEFAULT_WEIGHTS.deal +
    sellerSim * DEFAULT_WEIGHTS.seller +
    marketSim * DEFAULT_WEIGHTS.market +
    geoBonus * DEFAULT_WEIGHTS.geographic;

  return Math.min(1, overall);
}

function outcomeFromRoi(roi: number): string {
  if (roi >= 20) return "success";
  if (roi >= 5) return "partial_success";
  return "failure";
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dealPatternCloning — similarity scoring", () => {
  it("identical properties → score ≈ 1.0", () => {
    const fp: PatternFingerprint = {
      property: { acreage: 40, county: "Hudspeth", state: "TX", zoning: "agricultural", terrain: "flat" },
      deal: { type: "acquisition" },
      market: { pricePerAcre: 2000 },
    };
    const score = calculateOverallSimilarity(fp, fp);
    expect(score).toBeGreaterThan(0.9);
  });

  it("different counties same state → geographic bonus = 0.5", () => {
    const a: PropertyFingerprint = { acreage: 10, county: "Hudspeth", state: "TX" };
    const b: PropertyFingerprint = { acreage: 10, county: "Culberson", state: "TX" };
    expect(calculateGeographicBonus(a, b)).toBe(0.5);
  });

  it("different states → geographic bonus = 0", () => {
    const a: PropertyFingerprint = { acreage: 10, county: "Hudspeth", state: "TX" };
    const b: PropertyFingerprint = { acreage: 10, county: "Cochise", state: "AZ" };
    expect(calculateGeographicBonus(a, b)).toBe(0);
  });

  it("same county + state → geographic bonus = 1", () => {
    const a: PropertyFingerprint = { acreage: 10, county: "Hudspeth", state: "TX" };
    expect(calculateGeographicBonus(a, a)).toBe(1);
  });
});

describe("dealPatternCloning — normalizedEuclidean", () => {
  it("identical values → 1", () => {
    expect(normalizedEuclidean(40, 40, 1000)).toBe(1);
  });

  it("max distance → 0", () => {
    expect(normalizedEuclidean(0, 1000, 1000)).toBe(0);
  });

  it("half distance → 0.5", () => {
    expect(normalizedEuclidean(0, 500, 1000)).toBe(0.5);
  });

  it("beyond max range → clamps to 0", () => {
    expect(normalizedEuclidean(0, 2000, 1000)).toBe(0);
  });
});

describe("dealPatternCloning — jaccardSimilarity", () => {
  it("identical sets → 1", () => {
    expect(jaccardSimilarity(["electric", "water"], ["electric", "water"])).toBe(1);
  });

  it("disjoint sets → 0", () => {
    expect(jaccardSimilarity(["electric"], ["water"])).toBe(0);
  });

  it("partial overlap → correct ratio", () => {
    // intersection=1 (electric), union=3 (electric, water, sewer)
    expect(jaccardSimilarity(["electric", "water"], ["electric", "sewer"])).toBeCloseTo(1 / 3);
  });

  it("empty sets → 0 (not NaN)", () => {
    expect(jaccardSimilarity([], [])).toBe(0);
  });

  it("case-insensitive", () => {
    expect(jaccardSimilarity(["Electric"], ["electric"])).toBe(1);
  });
});

describe("dealPatternCloning — seller type detection", () => {
  it("individual name → individual", () => {
    expect(detectSellerType("John", "Smith")).toBe("individual");
  });

  it("LLC in name → corporate", () => {
    expect(detectSellerType("ABC Holdings", "LLC")).toBe("corporate");
  });

  it("estate in name → estate", () => {
    expect(detectSellerType("Smith Family", "Estate")).toBe("estate");
  });

  it("trust in name → estate", () => {
    expect(detectSellerType("Smith Revocable", "Trust")).toBe("estate");
  });

  it("INC in name → corporate", () => {
    expect(detectSellerType("Acme Land", "Inc")).toBe("corporate");
  });
});

describe("dealPatternCloning — outcome derivation", () => {
  it("ROI >= 20 → success", () => {
    expect(outcomeFromRoi(25)).toBe("success");
    expect(outcomeFromRoi(20)).toBe("success");
  });

  it("ROI 5-19 → partial_success", () => {
    expect(outcomeFromRoi(10)).toBe("partial_success");
    expect(outcomeFromRoi(5)).toBe("partial_success");
  });

  it("ROI < 5 → failure", () => {
    expect(outcomeFromRoi(4)).toBe("failure");
    expect(outcomeFromRoi(-10)).toBe("failure");
  });
});

describe("dealPatternCloning — overall similarity", () => {
  it("wildly different properties → low score", () => {
    const target: PatternFingerprint = {
      property: { acreage: 5, county: "Miami-Dade", state: "FL" },
      deal: { type: "disposition" },
      market: { pricePerAcre: 50000 },
    };
    const pattern: PatternFingerprint = {
      property: { acreage: 640, county: "Nye", state: "NV" },
      deal: { type: "acquisition" },
      market: { pricePerAcre: 500 },
    };
    const score = calculateOverallSimilarity(target, pattern);
    expect(score).toBeLessThan(0.5);
  });

  it("score is always between 0 and 1", () => {
    const fp: PatternFingerprint = {
      property: { acreage: 40, county: "Hudspeth", state: "TX" },
      deal: { type: "acquisition" },
    };
    const score = calculateOverallSimilarity(fp, fp);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
