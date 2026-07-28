/**
 * Land Credit Score — factor provenance (measured vs assumed) honesty contract.
 *
 * Background: the properties table has NO floodZone/wetlands/soilQuality
 * columns. The old scorer read `property.floodZone` (a column that never
 * existed), so floodRisk/wetlands/soilQuality silently sat at hardcoded
 * defaults while presenting as scored facts. The real per-parcel open data
 * lives in the `properties.enrichmentData` jsonb persisted by
 * PropertyEnrichmentService (FEMA NFHL / USFWS NWI / USDA NRCS SDA).
 *
 * These tests pin:
 *  1. Real stored evidence flows into the factor (measured, with source).
 *  2. Missing evidence keeps the exact pre-provenance default VALUE but is
 *     explicitly marked assumed (with a basis, never a source).
 *  3. An assumed factor can never masquerade as measured — across the whole
 *     calculateCreditScore payload.
 *  4. The persisted scoreBreakdown carries the same factorProvenance map.
 *
 * No DB required: server/db is mocked; the calibrator import is mocked so
 * effectiveWeights falls back to the methodology defaults.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock state ───────────────────────────────────────────────────────────────
const state = {
  property: null as any,
  scoreInserts: [] as any[],
};

vi.mock("../../server/db", () => ({
  db: {
    query: {
      properties: {
        findFirst: async () => state.property,
        findMany: async () => (state.property ? [state.property] : []),
      },
      landCreditScores: {
        findMany: async () => [],
      },
    },
    insert: (_table: any) => ({
      values: (v: any) => {
        state.scoreInserts.push(v);
        return Promise.resolve();
      },
    }),
  },
}));

// effectiveWeights dynamically imports the calibrator; return no calibrated
// weights so the methodology defaults apply (the catch-path is also fine).
vi.mock("../../server/services/lcsCalibrator", () => ({
  getCurrentWeights: async () => ({ weights: {}, source: "defaults" }),
}));

import {
  landCredit,
  floodRiskFromEvidence,
  wetlandsFromEvidence,
  soilQualityFromEvidence,
  ASSUMED_FACTOR_DEFAULTS,
  type FactorProvenance,
} from "../../server/services/landCredit";

beforeEach(() => {
  state.property = null;
  state.scoreInserts = [];
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function expectMeasured(p: FactorProvenance, source?: string) {
  expect(p.status).toBe("measured");
  expect(typeof p.source).toBe("string");
  expect((p.source as string).length).toBeGreaterThan(0);
  if (source) expect(p.source).toBe(source);
  expect(p.basis).toBeUndefined();
}

function expectAssumed(p: FactorProvenance) {
  expect(p.status).toBe("assumed");
  // An assumed value must never carry a named source — that would present a
  // default as a measurement.
  expect(p.source).toBeUndefined();
  expect(typeof p.basis).toBe("string");
  expect((p.basis as string).length).toBeGreaterThan(0);
}

const ENRICHMENT = {
  hazards: {
    floodZone: "Zone AE",
    wetlandsPresent: true,
    wetlandsPercentage: 12,
  },
  environment: { soilType: "Clay loam", soilSuitability: "limited" },
  provenance: {
    flood_zone: { source: "FEMA NFHL", asOf: "2026-01-15", fromCache: true },
    wetlands: { source: "USFWS NWI", asOf: null, fromCache: false },
    soil: { source: "USDA NRCS SDA", asOf: null, fromCache: false },
  },
} as any;

// ── floodRiskFromEvidence ───────────────────────────────────────────────────

describe("floodRiskFromEvidence", () => {
  it("maps a stored FEMA zone to the factor and marks it measured with source + asOf", () => {
    const r = floodRiskFromEvidence(ENRICHMENT);
    expect(r.score).toBe(40); // AE = high risk
    expectMeasured(r.provenance, "FEMA NFHL");
    expect(r.provenance.asOf).toBe("2026-01-15");
  });

  it("handles raw NFHL strings and bare codes (zone-family mapping)", () => {
    const cases: Array<[string, number]> = [
      ["Zone X (Minimal Risk)", 95],
      ["X", 95],
      ["C", 95],
      ["SHADED X", 75],
      ["B", 75],
      ["Zone AE", 40],
      ["A99", 40],
      ["AH", 40],
      ["Zone VE", 20],
      ["V", 20],
    ];
    for (const [zone, score] of cases) {
      const r = floodRiskFromEvidence({ hazards: { floodZone: zone } } as any);
      expect(r.score, zone).toBe(score);
      expect(r.provenance.status, zone).toBe("measured");
    }
  });

  it("treats Zone D (studied-but-undetermined) as assumed at the default value", () => {
    const r = floodRiskFromEvidence({ hazards: { floodZone: "D" } } as any);
    expect(r.score).toBe(ASSUMED_FACTOR_DEFAULTS.floodRisk);
    expectAssumed(r.provenance);
  });

  it("keeps the default VALUE (80) but marks it assumed when no evidence exists", () => {
    for (const enrichment of [null, undefined, {}, { hazards: {} }]) {
      const r = floodRiskFromEvidence(enrichment as any);
      expect(r.score).toBe(80);
      expectAssumed(r.provenance);
    }
  });
});

// ── wetlandsFromEvidence ────────────────────────────────────────────────────

describe("wetlandsFromEvidence", () => {
  it("mapped wetlands present → 40, measured (USFWS NWI)", () => {
    const r = wetlandsFromEvidence(ENRICHMENT);
    expect(r.score).toBe(40);
    expectMeasured(r.provenance, "USFWS NWI");
  });

  it("a clean NWI lookup (absent) scores the same VALUE as the default but is measured, not assumed", () => {
    const r = wetlandsFromEvidence({ hazards: { wetlandsPresent: false } } as any);
    expect(r.score).toBe(85);
    expectMeasured(r.provenance);
  });

  it("falls back to wetlandsPercentage when the boolean is missing", () => {
    const some = wetlandsFromEvidence({ hazards: { wetlandsPercentage: 30 } } as any);
    expect(some.score).toBe(40);
    expectMeasured(some.provenance);

    const none = wetlandsFromEvidence({ hazards: { wetlandsPercentage: 0 } } as any);
    expect(none.score).toBe(85);
    expectMeasured(none.provenance);
  });

  it("keeps the default VALUE (85) but marks it assumed when no lookup is stored", () => {
    const r = wetlandsFromEvidence(null);
    expect(r.score).toBe(ASSUMED_FACTOR_DEFAULTS.wetlands);
    expectAssumed(r.provenance);
  });
});

// ── soilQualityFromEvidence ─────────────────────────────────────────────────

describe("soilQualityFromEvidence", () => {
  it("maps capability-derived suitability to the factor, measured (USDA)", () => {
    const cases: Array<[string, number]> = [
      ["prime", 90],
      ["suitable", 70],
      ["limited", 45],
    ];
    for (const [suitability, score] of cases) {
      const r = soilQualityFromEvidence({ environment: { soilSuitability: suitability } } as any);
      expect(r.score, suitability).toBe(score);
      expectMeasured(r.provenance);
    }
  });

  it("treats the broker's 'good' no-capability-data default as ASSUMED, not measured", () => {
    const r = soilQualityFromEvidence({ environment: { soilSuitability: "good" } } as any);
    expect(r.score).toBe(ASSUMED_FACTOR_DEFAULTS.soilQuality);
    expectAssumed(r.provenance);
  });

  it("keeps the default VALUE (50) but marks it assumed when no soil data is stored", () => {
    const r = soilQualityFromEvidence(null);
    expect(r.score).toBe(50);
    expectAssumed(r.provenance);
  });
});

// ── Default values are unchanged from the pre-provenance model ──────────────

describe("assumed defaults preserve pre-provenance scoring behavior", () => {
  it("defaults are exactly the historical hardcoded values", () => {
    expect(ASSUMED_FACTOR_DEFAULTS).toEqual({
      floodRisk: 80,
      wetlands: 85,
      soilQuality: 50,
      growthRate: 60,
    });
  });
});

// ── Full calculateCreditScore path ──────────────────────────────────────────

function baseProperty(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    organizationId: 42,
    apn: "123-45-678",
    state: "NM", // avoids the TX/FL/CA/NY and wildfire state heuristics
    county: "Sierra",
    sizeAcres: "40",
    ...overrides,
  };
}

describe("calculateCreditScore — provenance travels with the payload", () => {
  it("real enrichment flows into the factors and is marked measured", async () => {
    state.property = baseProperty({ enrichmentData: ENRICHMENT });

    const result = await landCredit.calculateCreditScore("42", "1");

    // Measured values flowed into the factors
    expect(result.factors.environmental.factors.floodRisk).toBe(40);
    expect(result.factors.environmental.factors.wetlands).toBe(40);
    expect(result.factors.physical.factors.soilQuality).toBe(45);

    // ...and are labeled measured with their sources
    expectMeasured(result.factorProvenance.environmental.floodRisk, "FEMA NFHL");
    expectMeasured(result.factorProvenance.environmental.wetlands, "USFWS NWI");
    expectMeasured(result.factorProvenance.physical.soilQuality, "USDA NRCS SDA");
  });

  it("without enrichment the factors keep their historical defaults and are marked assumed", async () => {
    state.property = baseProperty();

    const result = await landCredit.calculateCreditScore("42", "1");

    expect(result.factors.environmental.factors.floodRisk).toBe(80);
    expect(result.factors.environmental.factors.wetlands).toBe(85);
    expect(result.factors.physical.factors.soilQuality).toBe(50);
    expect(result.factors.location.factors.growthRate).toBe(60);
    // Pre-provenance environmental dimension score for a default parcel:
    // 80*.3 + 80*.25 + 90*.2 + 85*.15 + 85*.1 = 83.25 → 83 (unchanged).
    expect(result.factors.environmental.score).toBe(83);

    expectAssumed(result.factorProvenance.environmental.floodRisk);
    expectAssumed(result.factorProvenance.environmental.wetlands);
    expectAssumed(result.factorProvenance.physical.soilQuality);
    expectAssumed(result.factorProvenance.location.growthRate);
  });

  it("growthRate stays assumed even under the state heuristic (a statewide guess is not a measurement)", async () => {
    state.property = baseProperty({ state: "TX" });

    const result = await landCredit.calculateCreditScore("42", "1");

    expect(result.factors.location.factors.growthRate).toBe(80); // heuristic value unchanged
    expectAssumed(result.factorProvenance.location.growthRate);
  });

  it("an assumed factor never masquerades as measured anywhere in the payload", async () => {
    state.property = baseProperty({ enrichmentData: ENRICHMENT });

    const result = await landCredit.calculateCreditScore("42", "1");

    const dims = Object.keys(result.factorProvenance) as Array<
      keyof typeof result.factorProvenance
    >;
    expect(dims.sort()).toEqual(
      ["environmental", "financial", "legal", "location", "market", "physical"].sort()
    );
    for (const dim of dims) {
      const perFactor = result.factorProvenance[dim];
      // Every sub-factor in the dimension has a provenance entry
      expect(Object.keys(perFactor).sort()).toEqual(
        Object.keys(result.factors[dim].factors).sort()
      );
      for (const [name, prov] of Object.entries(perFactor)) {
        if (prov.status === "measured") {
          expect(prov.source, `${dim}.${name}`).toBeTruthy();
        } else {
          expect(prov.status, `${dim}.${name}`).toBe("assumed");
          expect(prov.source, `${dim}.${name}`).toBeUndefined();
          expect(prov.basis, `${dim}.${name}`).toBeTruthy();
        }
      }
    }
  });

  it("persists factorProvenance inside scoreBreakdown with the methodology stamp", async () => {
    state.property = baseProperty({ enrichmentData: ENRICHMENT });

    await landCredit.calculateCreditScore("42", "1");

    expect(state.scoreInserts.length).toBe(1);
    const row = state.scoreInserts[0];
    expect(row.modelVersion).toBe("v1");
    expect(row.scoreBreakdown.factorProvenance.environmental.floodRisk.status).toBe("measured");
    expect(row.scoreBreakdown.factorProvenance.environmental.floodRisk.source).toBe("FEMA NFHL");
    // Canonical calibrator keys still present (S2a contract intact)
    for (const k of ["location", "physical", "legal", "financial", "environmental", "market", "factors"]) {
      expect(row.scoreBreakdown[k]).toBeDefined();
    }
  });
});
