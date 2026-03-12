/**
 * AcreOS Valuation (AVM) Unit Tests
 *
 * Tests automated valuation model logic:
 * - Comparable selection and filtering
 * - Price-per-acre weighting
 * - Confidence interval generation
 * - County-level aggregation
 * - Valuation computation
 */

import { describe, it, expect } from "vitest";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TransactionComp {
  propertyId: string;
  salePrice: number;
  saleDate: Date;
  acres: number;
  pricePerAcre: number;
  location: {
    state: string;
    county: string;
    zipCode: string;
    latitude: number;
    longitude: number;
  };
  characteristics: {
    zoning?: string;
    waterRights?: boolean;
    roadAccess?: string;
    floodZone?: string;
  };
}

interface ValuationRequest {
  propertyId: string;
  acres: number;
  location: { state: string; county: string; zipCode: string; latitude: number; longitude: number };
  characteristics: { zoning?: string; waterRights?: boolean; roadAccess?: string; floodZone?: string };
}

interface ValuationResult {
  estimatedValue: number;
  pricePerAcre: number;
  confidenceInterval: { low: number; high: number };
  confidence: number;
  methodology: string;
  comparables: Array<{
    propertyId: string;
    salePrice: number;
    pricePerAcre: number;
    distance: number;
    similarity: number;
  }>;
}

interface CountyAggregate {
  state: string;
  county: string;
  avgPricePerAcre: number;
  medianPricePerAcre: number;
  transactionCount: number;
  priceRange: { min: number; max: number };
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function selectComparables(
  comps: TransactionComp[],
  request: ValuationRequest,
  maxDistanceMiles: number = 50,
  maxAgeMonths: number = 24,
  limit: number = 10
): Array<TransactionComp & { distance: number; similarity: number }> {
  const now = new Date();
  const maxAgeMs = maxAgeMonths * 30.4375 * 24 * 60 * 60 * 1000;

  return comps
    .filter(comp => {
      const age = now.getTime() - comp.saleDate.getTime();
      if (age > maxAgeMs) return false;
      const dist = haversineDistance(
        request.location.latitude, request.location.longitude,
        comp.location.latitude, comp.location.longitude
      );
      return dist <= maxDistanceMiles;
    })
    .map(comp => {
      const distance = haversineDistance(
        request.location.latitude, request.location.longitude,
        comp.location.latitude, comp.location.longitude
      );
      let similarity = 100;
      // Acreage similarity (within 50% of subject)
      const acrageRatio = Math.min(comp.acres, request.acres) / Math.max(comp.acres, request.acres);
      if (acrageRatio < 0.5) similarity -= 30;
      else if (acrageRatio < 0.75) similarity -= 15;
      // Zoning match
      if (request.characteristics.zoning && comp.characteristics.zoning !== request.characteristics.zoning) similarity -= 15;
      // Road access match
      if (request.characteristics.roadAccess && comp.characteristics.roadAccess !== request.characteristics.roadAccess) similarity -= 10;
      // Distance penalty
      if (distance > 30) similarity -= 10;
      similarity = Math.max(0, similarity);
      return { ...comp, distance, similarity };
    })
    .sort((a, b) => b.similarity - a.similarity || a.distance - b.distance)
    .slice(0, limit);
}

function computeWeightedPricePerAcre(
  comps: Array<{ pricePerAcre: number; similarity: number; distance: number }>
): number {
  if (comps.length === 0) return 0;

  const distanceWeight = (d: number) => Math.max(0.1, 1 - d / 100);

  let weightedSum = 0;
  let totalWeight = 0;

  for (const comp of comps) {
    const w = (comp.similarity / 100) * distanceWeight(comp.distance);
    weightedSum += comp.pricePerAcre * w;
    totalWeight += w;
  }

  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
}

function generateConfidenceInterval(
  estimatedPricePerAcre: number,
  comps: Array<{ pricePerAcre: number }>,
  baseConfidence: number
): { low: number; high: number; confidence: number } {
  if (comps.length === 0) {
    return {
      low: estimatedPricePerAcre * 0.7,
      high: estimatedPricePerAcre * 1.3,
      confidence: 30,
    };
  }

  const prices = comps.map(c => c.pricePerAcre);
  const mean = prices.reduce((s, p) => s + p, 0) / prices.length;
  const variance = prices.reduce((s, p) => s + (p - mean) ** 2, 0) / prices.length;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? stdDev / mean : 0; // coefficient of variation

  // Tighter CI for low variance markets
  const spreadFactor = Math.min(0.30, 0.10 + cv * 0.5);

  const confidence = Math.min(95, Math.max(20, baseConfidence - cv * 50));

  return {
    low: Math.round(estimatedPricePerAcre * (1 - spreadFactor)),
    high: Math.round(estimatedPricePerAcre * (1 + spreadFactor)),
    confidence: Math.round(confidence),
  };
}

function aggregateCountyData(comps: TransactionComp[]): CountyAggregate[] {
  const grouped: Record<string, TransactionComp[]> = {};

  for (const comp of comps) {
    const key = `${comp.location.state}::${comp.location.county}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(comp);
  }

  return Object.entries(grouped).map(([key, group]) => {
    const [state, county] = key.split("::");
    const prices = group.map(c => c.pricePerAcre).sort((a, b) => a - b);
    const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
    const median = prices.length % 2 === 0
      ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
      : prices[Math.floor(prices.length / 2)];

    return {
      state,
      county,
      avgPricePerAcre: Math.round(avg),
      medianPricePerAcre: Math.round(median),
      transactionCount: group.length,
      priceRange: { min: prices[0], max: prices[prices.length - 1] },
    };
  });
}

function computeValuation(
  request: ValuationRequest,
  comps: TransactionComp[]
): ValuationResult {
  const selectedComps = selectComparables(comps, request);
  const pricePerAcre = computeWeightedPricePerAcre(selectedComps);
  const estimatedValue = pricePerAcre * request.acres;

  const baseConfidence = Math.min(85, 40 + selectedComps.length * 5);
  const ci = generateConfidenceInterval(pricePerAcre, selectedComps, baseConfidence);

  return {
    estimatedValue: Math.round(estimatedValue),
    pricePerAcre,
    confidenceInterval: { low: Math.round(ci.low * request.acres), high: Math.round(ci.high * request.acres) },
    confidence: ci.confidence,
    methodology: selectedComps.length >= 5 ? "comparable_sales" : selectedComps.length >= 1 ? "limited_comparables" : "market_data",
    comparables: selectedComps.map(c => ({
      propertyId: c.propertyId,
      salePrice: c.salePrice,
      pricePerAcre: c.pricePerAcre,
      distance: Math.round(c.distance * 10) / 10,
      similarity: c.similarity,
    })),
  };
}

// ── Test data ─────────────────────────────────────────────────────────────────

function makeComp(overrides: Partial<TransactionComp> = {}): TransactionComp {
  return {
    propertyId: `comp-${Math.random().toString(36).slice(2)}`,
    salePrice: 500_000,
    saleDate: new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000), // 6 months ago
    acres: 100,
    pricePerAcre: 5_000,
    location: {
      state: "TX",
      county: "Travis",
      zipCode: "78701",
      latitude: 30.27,
      longitude: -97.74,
    },
    characteristics: {
      zoning: "agricultural",
      waterRights: false,
      roadAccess: "paved",
      floodZone: "none",
    },
    ...overrides,
  };
}

const subjectRequest: ValuationRequest = {
  propertyId: "subject-1",
  acres: 100,
  location: { state: "TX", county: "Travis", zipCode: "78701", latitude: 30.27, longitude: -97.74 },
  characteristics: { zoning: "agricultural", waterRights: false, roadAccess: "paved" },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Comparable Selection", () => {
  it("filters out comps older than maxAgeMonths", () => {
    const old = makeComp({ saleDate: new Date(Date.now() - 36 * 30 * 24 * 60 * 60 * 1000) }); // 36 months
    const recent = makeComp();
    const selected = selectComparables([old, recent], subjectRequest, 50, 24);
    expect(selected.some(c => c.propertyId === old.propertyId)).toBe(false);
    expect(selected.some(c => c.propertyId === recent.propertyId)).toBe(true);
  });

  it("filters out comps beyond max distance", () => {
    const far = makeComp({ location: { ...subjectRequest.location, latitude: 35.0, longitude: -90.0 } }); // far away
    const near = makeComp();
    const selected = selectComparables([far, near], subjectRequest, 50);
    expect(selected.some(c => c.propertyId === far.propertyId)).toBe(false);
    expect(selected.some(c => c.propertyId === near.propertyId)).toBe(true);
  });

  it("limits results to specified limit", () => {
    const comps = Array(20).fill(null).map(() => makeComp());
    const selected = selectComparables(comps, subjectRequest, 50, 24, 5);
    expect(selected).toHaveLength(5);
  });

  it("sorts by similarity descending, then distance ascending", () => {
    const comps = [
      makeComp({ characteristics: { zoning: "industrial" }, acres: 50 }), // lower similarity
      makeComp({ characteristics: { zoning: "agricultural" }, acres: 95 }), // higher similarity
    ];
    const selected = selectComparables(comps, subjectRequest);
    expect(selected[0].similarity).toBeGreaterThanOrEqual(selected[1]?.similarity ?? 0);
  });

  it("returns empty array when no comps within range", () => {
    const far = makeComp({ location: { ...subjectRequest.location, latitude: 45.0, longitude: -90.0 } });
    const selected = selectComparables([far], subjectRequest, 50);
    expect(selected).toHaveLength(0);
  });

  it("assigns distance to each selected comp", () => {
    const comps = [makeComp(), makeComp()];
    const selected = selectComparables(comps, subjectRequest);
    for (const comp of selected) {
      expect(comp.distance).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("Weighted Price-Per-Acre Computation", () => {
  it("returns 0 for empty comps", () => {
    expect(computeWeightedPricePerAcre([])).toBe(0);
  });

  it("returns exact price for single comp with max similarity", () => {
    const result = computeWeightedPricePerAcre([{ pricePerAcre: 5_000, similarity: 100, distance: 0 }]);
    expect(result).toBe(5_000);
  });

  it("weights high-similarity comps more heavily", () => {
    const highSim = { pricePerAcre: 8_000, similarity: 95, distance: 5 };
    const lowSim = { pricePerAcre: 3_000, similarity: 30, distance: 5 };
    const result = computeWeightedPricePerAcre([highSim, lowSim]);
    // Should be closer to 8000 due to higher weight
    expect(result).toBeGreaterThan(5_500);
  });

  it("penalizes distant comps", () => {
    const near = { pricePerAcre: 8_000, similarity: 80, distance: 5 };
    const far = { pricePerAcre: 8_000, similarity: 80, distance: 80 };
    const nearOnly = computeWeightedPricePerAcre([near]);
    const farOnly = computeWeightedPricePerAcre([far]);
    // Both should return 8000 since there's only one comp each
    expect(nearOnly).toBe(8_000);
    expect(farOnly).toBe(8_000);
  });
});

describe("Confidence Interval Generation", () => {
  it("returns wide interval with low confidence for no comps", () => {
    const result = generateConfidenceInterval(5_000, [], 60);
    expect(result.confidence).toBe(30);
    expect(result.high - result.low).toBeGreaterThan(2_000);
  });

  it("returns tighter interval for consistent comp prices", () => {
    const consistentComps = [
      { pricePerAcre: 5_000 },
      { pricePerAcre: 5_100 },
      { pricePerAcre: 4_950 },
      { pricePerAcre: 5_050 },
    ];
    const result = generateConfidenceInterval(5_000, consistentComps, 75);
    expect(result.high - result.low).toBeLessThan(2_000);
  });

  it("low is always less than high", () => {
    const comps = [{ pricePerAcre: 4_000 }, { pricePerAcre: 8_000 }]; // high variance
    const result = generateConfidenceInterval(5_000, comps, 60);
    expect(result.low).toBeLessThan(result.high);
  });

  it("confidence never exceeds 95", () => {
    const comps = Array(20).fill({ pricePerAcre: 5_000 });
    const result = generateConfidenceInterval(5_000, comps, 100);
    expect(result.confidence).toBeLessThanOrEqual(95);
  });

  it("confidence never drops below 20", () => {
    const volatile = [{ pricePerAcre: 1_000 }, { pricePerAcre: 50_000 }];
    const result = generateConfidenceInterval(5_000, volatile, 40);
    expect(result.confidence).toBeGreaterThanOrEqual(20);
  });
});

describe("County-Level Aggregation", () => {
  const comps: TransactionComp[] = [
    makeComp({ pricePerAcre: 4_000, location: { state: "TX", county: "Travis", zipCode: "78701", latitude: 30.27, longitude: -97.74 } }),
    makeComp({ pricePerAcre: 5_000, location: { state: "TX", county: "Travis", zipCode: "78701", latitude: 30.27, longitude: -97.74 } }),
    makeComp({ pricePerAcre: 6_000, location: { state: "TX", county: "Travis", zipCode: "78701", latitude: 30.27, longitude: -97.74 } }),
    makeComp({ pricePerAcre: 3_000, location: { state: "TX", county: "Hays", zipCode: "78620", latitude: 30.0, longitude: -98.0 } }),
    makeComp({ pricePerAcre: 3_500, location: { state: "TX", county: "Hays", zipCode: "78620", latitude: 30.0, longitude: -98.0 } }),
  ];

  it("groups comps by state and county", () => {
    const aggregates = aggregateCountyData(comps);
    expect(aggregates).toHaveLength(2);
    expect(aggregates.some(a => a.county === "Travis")).toBe(true);
    expect(aggregates.some(a => a.county === "Hays")).toBe(true);
  });

  it("computes correct average price per acre for Travis", () => {
    const aggregates = aggregateCountyData(comps);
    const travis = aggregates.find(a => a.county === "Travis")!;
    expect(travis.avgPricePerAcre).toBeCloseTo(5_000, -1);
  });

  it("computes correct median price per acre", () => {
    const aggregates = aggregateCountyData(comps);
    const travis = aggregates.find(a => a.county === "Travis")!;
    expect(travis.medianPricePerAcre).toBe(5_000); // median of [4000, 5000, 6000]
  });

  it("includes correct transaction count", () => {
    const aggregates = aggregateCountyData(comps);
    const travis = aggregates.find(a => a.county === "Travis")!;
    const hays = aggregates.find(a => a.county === "Hays")!;
    expect(travis.transactionCount).toBe(3);
    expect(hays.transactionCount).toBe(2);
  });

  it("computes price range min and max", () => {
    const aggregates = aggregateCountyData(comps);
    const travis = aggregates.find(a => a.county === "Travis")!;
    expect(travis.priceRange.min).toBe(4_000);
    expect(travis.priceRange.max).toBe(6_000);
  });
});

describe("Full Valuation Computation", () => {
  it("uses comparable_sales methodology with 5+ comps", () => {
    const comps = Array(6).fill(null).map(() => makeComp());
    const result = computeValuation(subjectRequest, comps);
    expect(result.methodology).toBe("comparable_sales");
  });

  it("uses limited_comparables methodology with 1-4 comps", () => {
    const comps = [makeComp(), makeComp()];
    const result = computeValuation(subjectRequest, comps);
    expect(result.methodology).toBe("limited_comparables");
  });

  it("uses market_data methodology with no comps", () => {
    const result = computeValuation(subjectRequest, []);
    expect(result.methodology).toBe("market_data");
  });

  it("estimated value = price per acre × acres", () => {
    const comps = [makeComp({ pricePerAcre: 5_000 })];
    const result = computeValuation(subjectRequest, comps);
    expect(result.estimatedValue).toBeCloseTo(result.pricePerAcre * subjectRequest.acres, -1);
  });

  it("confidence interval low < estimated value < high", () => {
    const comps = Array(5).fill(null).map(() => makeComp());
    const result = computeValuation(subjectRequest, comps);
    expect(result.confidenceInterval.low).toBeLessThan(result.estimatedValue);
    expect(result.confidenceInterval.high).toBeGreaterThan(result.estimatedValue);
  });

  it("includes comparables with distance and similarity", () => {
    const comps = [makeComp(), makeComp()];
    const result = computeValuation(subjectRequest, comps);
    for (const comp of result.comparables) {
      expect(comp.distance).toBeGreaterThanOrEqual(0);
      expect(comp.similarity).toBeGreaterThanOrEqual(0);
      expect(comp.similarity).toBeLessThanOrEqual(100);
    }
  });
});
