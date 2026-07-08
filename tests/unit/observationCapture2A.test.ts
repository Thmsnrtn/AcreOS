/**
 * Tier 2A — Observation capture (elevation-blueprint-2026-06-10.md).
 *
 * Pins the five load-bearing behaviors this stream added:
 *   1. Widened provider facts → observation batches (assessed/market value,
 *      tax status, sale history) via the pure buildParcelFactBatches.
 *   2. Dated sale observations: observedAt = the SALE date, never today;
 *      implausible dates emit nothing (no fabricated history).
 *   3. deriveOwnerTenure uses sale events as tenure boundaries (refined
 *      current-owner start, deed cadence), and stays backward compatible
 *      when no sale events exist.
 *   4. LCS calibrator persistence round-trip: snapshots written to
 *      model_calibration_log and hydrated back after a "deploy" (fresh
 *      in-memory state).
 *   5. Cache-hit telemetry: recordLookup persists cacheLane +
 *      avoidedCostCents into provider_lookup_log.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── shared in-memory db fake ─────────────────────────────────────────────────
const dbState: {
  inserts: Array<{ target: any; rows: any[] }>;
  selectRows: any[];
} = { inserts: [], selectRows: [] };

vi.mock("@shared/schema", () => ({
  parcelObservations: { __table: "parcel_observations" },
  providerLookupLog: { __table: "provider_lookup_log" },
  modelCalibrationLog: {
    __table: "model_calibration_log",
    organizationId: { name: "organization_id" },
    modelName: { name: "model_name" },
    createdAt: { name: "created_at" },
  },
  deals: {
    id: { name: "id" },
    propertyId: { name: "property_id" },
    offerAmount: { name: "offer_amount" },
    acceptedAmount: { name: "accepted_amount" },
    organizationId: { name: "organization_id" },
    updatedAt: { name: "updated_at" },
    status: { name: "status" },
  },
  landCreditScores: {
    propertyId: { name: "property_id" },
    overallScore: { name: "overall_score" },
    createdAt: { name: "created_at" },
    state: { name: "state" },
  },
}));

vi.mock("../../server/db", () => {
  const makeChain = () => {
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "where", "orderBy", "limit"]) {
      chain[m] = vi.fn(() => chain);
    }
    (chain as { then?: unknown }).then = (resolve: (rows: unknown[]) => void) =>
      resolve(dbState.selectRows);
    return chain;
  };
  return {
    db: {
      select: vi.fn(() => makeChain()),
      insert: (target: any) => ({
        values: async (rows: any) => {
          dbState.inserts.push({ target, rows: Array.isArray(rows) ? rows : [rows] });
          return [];
        },
      }),
      execute: vi.fn(async () => ({ rows: [] })),
    },
  };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/services/alertSpine", () => ({
  raiseAlert: vi.fn(async () => ({ paged: false, findingRecorded: true, systemAlertWritten: true })),
}));

import {
  buildParcelFactBatches,
  coerceSaleDate,
} from "../../server/services/data-cache/observation-log";
import { deriveOwnerTenure, type SeriesPoint } from "../../server/services/parcel-biography";
import { recordLookup } from "../../server/services/providerIntelligence";

beforeEach(() => {
  dbState.inserts = [];
  dbState.selectRows = [];
});

const point = (value: string, iso: string): SeriesPoint => ({
  value,
  numeric: null,
  source: "county_gis",
  confidence: null,
  observedAt: new Date(iso),
});

// ─────────────────────────────────────────────────────────────────────────────
// 1 + 2. Widened facts + dated sale emission
// ─────────────────────────────────────────────────────────────────────────────

describe("buildParcelFactBatches — widened facts + dated sale history", () => {
  const base = {
    apn: "123-45-678",
    state: "AZ",
    county: "Cochise",
    source: "county_gis",
  };

  it("captures assessed/market value, tax status, and core facts in the current batch", () => {
    const batches = buildParcelFactBatches({
      ...base,
      owner: "Jane Smith",
      ownerAddress: "1 Main St",
      siteAddress: "2 Site Rd",
      taxAmount: 412.5,
      acres: 10.2,
      assessedValue: 25000,
      marketValue: 41000,
      taxStatus: "DELINQUENT",
    });
    expect(batches).toHaveLength(1);
    const facts = batches[0].facts;
    expect(facts.owner).toBe("Jane Smith");
    expect(facts.assessed_value).toBe(25000);
    expect(facts.market_value).toBe(41000);
    expect(facts.tax_status).toBe("DELINQUENT");
    expect(facts.tax_amount).toBe(412.5);
    expect(facts.acres).toBe(10.2);
    // No sale data → no dated batch, ever.
    expect(batches[0].observedAt).toBeUndefined();
  });

  it("emits a DATED batch (observedAt = sale date) when the sale date parses", () => {
    const batches = buildParcelFactBatches({
      ...base,
      lastSalePrice: 85000,
      lastSaleDate: "2009-03-15",
    });
    expect(batches).toHaveLength(2);
    const dated = batches[1];
    expect(dated.observedAt).toBeInstanceOf(Date);
    expect(dated.observedAt!.getUTCFullYear()).toBe(2009);
    expect(dated.facts.deed_date).toBe("2009-03-15");
    expect(dated.facts.sale_price).toBe(85000);
  });

  it("handles ArcGIS epoch-ms sale dates", () => {
    const epochMs = Date.UTC(2015, 5, 1); // 2015-06-01
    const batches = buildParcelFactBatches({ ...base, lastSaleDate: epochMs });
    expect(batches).toHaveLength(2);
    expect(batches[1].observedAt!.getUTCFullYear()).toBe(2015);
  });

  it("NEVER stamps a sale with today's date when the date is implausible or missing", () => {
    for (const bad of [undefined, null, "", "garbage", "0", 1899, "1850-01-01", "3001-01-01"]) {
      const batches = buildParcelFactBatches({ ...base, lastSalePrice: 1000, lastSaleDate: bad });
      expect(batches).toHaveLength(1); // current batch only — no fabricated history
    }
  });

  it("skips the placeholder owner 'Unknown'", () => {
    const batches = buildParcelFactBatches({ ...base, owner: "Unknown" });
    expect(batches[0].facts.owner).toBeUndefined();
  });

  it("coerceSaleDate gates implausible years and accepts Date/string/epoch-ms", () => {
    expect(coerceSaleDate(new Date("2010-01-02"))?.getUTCFullYear()).toBe(2010);
    expect(coerceSaleDate("2010-01-02")?.getUTCFullYear()).toBe(2010);
    expect(coerceSaleDate(Date.UTC(2010, 0, 2))?.getUTCFullYear()).toBe(2010);
    expect(coerceSaleDate("1850-01-01")).toBeNull();
    expect(coerceSaleDate("not a date")).toBeNull();
    expect(coerceSaleDate(42)).toBeNull(); // small numbers are not epoch-ms
    expect(coerceSaleDate(null)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Tenure from sale boundaries
// ─────────────────────────────────────────────────────────────────────────────

describe("deriveOwnerTenure — sale events as tenure boundaries", () => {
  const asOf = new Date("2026-06-10T00:00:00Z");

  it("backward compatible: no sale events behaves as before", () => {
    const tenure = deriveOwnerTenure(
      [point("Alice", "2024-01-01"), point("Alice", "2025-01-01")],
      asOf,
    );
    expect(tenure).not.toBeNull();
    expect(tenure!.changeCount).toBe(0);
    expect(tenure!.currentOwnerSince?.toISOString().slice(0, 10)).toBe("2024-01-01");
    expect(tenure!.currentTenureYears).toBe(2);
  });

  it("pulls currentOwnerSince back to the sale date that started the hold", () => {
    // First observed in 2024, but the deed records a 2009 sale — the clock
    // should show ~17 years of tenure, not 2.
    const tenure = deriveOwnerTenure(
      [point("Alice", "2024-01-01"), point("Alice", "2025-06-01")],
      asOf,
      [new Date("2009-03-15")],
    );
    expect(tenure!.currentOwnerSince?.toISOString().slice(0, 10)).toBe("2009-03-15");
    expect(tenure!.currentTenureYears).toBe(17);
  });

  it("does not attribute a sale that belongs to the PREVIOUS owner's hold", () => {
    // Bob last seen 2020-05-01; a 2015 sale belongs to Bob's hold, not Alice's.
    const tenure = deriveOwnerTenure(
      [point("Bob", "2014-01-01"), point("Bob", "2020-05-01"), point("Alice", "2022-01-01")],
      asOf,
      [new Date("2015-02-01")],
    );
    expect(tenure!.currentOwnerSince?.toISOString().slice(0, 10)).toBe("2022-01-01");
  });

  it("refines the current start with a sale in the transition window", () => {
    // Bob last seen 2020-05-01, Alice first seen 2022-01-01; the 2021-03-10
    // sale falls in the gap → Alice's tenure starts at the sale.
    const tenure = deriveOwnerTenure(
      [point("Bob", "2014-01-01"), point("Bob", "2020-05-01"), point("Alice", "2022-01-01")],
      asOf,
      [new Date("2021-03-10")],
    );
    expect(tenure!.currentOwnerSince?.toISOString().slice(0, 10)).toBe("2021-03-10");
  });

  it("counts distant sales as extra deed-cadence boundaries and computes cadence", () => {
    // Observed: one owner change (Bob→Alice). Sales add two MORE boundaries
    // far from observed ones (1998, 2008) → 4 boundaries, 3 transitions.
    const tenure = deriveOwnerTenure(
      [point("Bob", "2014-01-01"), point("Alice", "2021-01-01")],
      asOf,
      [new Date("1998-06-01"), new Date("2008-06-01")],
    );
    expect(tenure!.changeCount).toBe(3);
    expect(tenure!.medianYearsBetweenChanges).not.toBeNull();
  });

  it("a sale within ±1 year of an observed boundary is the SAME hand-change, not a new one", () => {
    const tenure = deriveOwnerTenure(
      [point("Bob", "2014-01-01"), point("Alice", "2021-01-01")],
      asOf,
      [new Date("2020-09-15")], // same transition seen via the deed
    );
    // Boundary count stays 2 (Bob start + Alice start refined to the sale).
    expect(tenure!.changeCount).toBe(1);
    expect(tenure!.currentOwnerSince?.toISOString().slice(0, 10)).toBe("2020-09-15");
  });

  it("ignores future-dated sale events", () => {
    const tenure = deriveOwnerTenure(
      [point("Alice", "2024-01-01")],
      asOf,
      [new Date("2030-01-01")],
    );
    expect(tenure!.currentOwnerSince?.toISOString().slice(0, 10)).toBe("2024-01-01");
    expect(tenure!.changeCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Calibrator persistence round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe("lcsCalibrator — persisted weights survive a deploy", () => {
  it("getCurrentWeights hydrates the latest persisted snapshot from model_calibration_log", async () => {
    vi.resetModules(); // fresh in-memory Maps = post-deploy process
    const persisted = {
      weights: { location: 30, physical: 18, legal: 14, financial: 18, environmental: 10, market: 10 },
      correlations: { location: 0.61 },
      sampleSize: 42,
      adjusted: true,
      reason: "Weights calibrated based on outcome correlations",
      createdAt: new Date("2026-06-01T00:00:00Z"),
      organizationId: 7,
      modelName: "lcs_calibrator",
    };
    dbState.selectRows = [persisted];

    const { getCurrentWeights } = await import("../../server/services/lcsCalibrator");
    const { weights, history, lastUpdated } = await getCurrentWeights(7);

    expect(weights).toEqual(persisted.weights);
    expect(history).toHaveLength(1);
    expect(history[0].sampleSize).toBe(42);
    expect(lastUpdated).toBe("2026-06-01T00:00:00.000Z");
  });

  it("falls back to defaults when nothing is persisted", async () => {
    vi.resetModules();
    dbState.selectRows = [];
    const { getCurrentWeights } = await import("../../server/services/lcsCalibrator");
    const { weights, lastUpdated } = await getCurrentWeights(9);
    expect(weights.location).toBe(25);
    expect(weights.market).toBe(10);
    expect(lastUpdated).toBeNull();
  });

  it("an insufficient-data calibration run does NOT write a snapshot", async () => {
    vi.resetModules();
    dbState.selectRows = []; // no persisted weights, no closed deals
    const { runLcsCalibration } = await import("../../server/services/lcsCalibrator");
    const result = await runLcsCalibration(11);
    expect(result.adjusted).toBe(false);
    const calibrationInserts = dbState.inserts.filter(
      (i) => i.target?.__table === "model_calibration_log",
    );
    expect(calibrationInserts).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Cache-hit telemetry
// ─────────────────────────────────────────────────────────────────────────────

describe("providerIntelligence.recordLookup — cache lane telemetry", () => {
  it("persists cacheLane and avoidedCostCents on a cache hit", async () => {
    await recordLookup({
      providerName: "regrid",
      category: "parcel_boundary",
      inputType: "apn",
      success: true,
      cached: true,
      cacheLane: "provider_cache",
      costCents: 0,
      avoidedCostCents: 12,
      organizationId: 3,
      state: "AZ",
      county: "Cochise",
    });
    const writes = dbState.inserts.filter((i) => i.target?.__table === "provider_lookup_log");
    expect(writes).toHaveLength(1);
    const row = writes[0].rows[0];
    expect(row.cacheLane).toBe("provider_cache");
    expect(row.avoidedCostCents).toBe(12);
    expect(row.cached).toBe(true);
    expect(row.costCents).toBe(0);
  });

  it("defaults cacheLane to null and avoidedCostCents to 0 on live lookups", async () => {
    await recordLookup({
      providerName: "regrid",
      category: "parcel_boundary",
      inputType: "apn",
      success: true,
      cached: false,
      costCents: 12,
    });
    const row = dbState.inserts.filter((i) => i.target?.__table === "provider_lookup_log")[0]
      .rows[0];
    expect(row.cacheLane).toBeNull();
    expect(row.avoidedCostCents).toBe(0);
  });
});
