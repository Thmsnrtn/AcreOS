/**
 * Fused county momentum (Open-Data 2.x) — getCountyMomentum + the acquisition
 * radar wiring.
 *
 * No Postgres in this environment: the fusion reads its three signals through
 * the exported `_momentumSignalReaders` seam (same pattern as etlHandlers
 * `_runtime` in countyMarketSignalsEtl.test.ts), so no query ever runs.
 *
 * Honesty invariants under test:
 *  - composite requires >=2 of 3 signals; fewer -> partial evidence, no score
 *  - every evidence item carries its source label + data years + raw values
 *  - missing signals are listed as missing, never treated as neutral
 *  - radar path is null-safe: no momentum -> same score as today, and the
 *    result SAYS the signal was unavailable
 */

import { describe, it, expect, afterEach, vi } from "vitest";

// db is imported transitively (countyMarketSignals, acquisitionRadar,
// data-source-broker); stub so the modules load without Postgres.
vi.mock("../../server/db", () => ({ db: {} }));
// data-source-broker imports the full storage facade at module level.
vi.mock("../../server/storage", () => ({ storage: {} }));

import {
  getCountyMomentum,
  _momentumSignalReaders,
  type CountyMigrationSignal,
  type CountyPermitTrend,
  type CountyEmploymentSignal,
} from "../../server/services/openData/countyMarketSignals";
import { acquisitionRadar } from "../../server/services/acquisitionRadar";

// ─── Reader stubs ────────────────────────────────────────────────────────────

const originalReaders = { ..._momentumSignalReaders };
afterEach(() => {
  Object.assign(_momentumSignalReaders, originalReaders);
});

const MIGRATION: CountyMigrationSignal = {
  netReturns: 228,
  netAgiThousands: 20486,
  filingYear: "2223",
};

const PERMITS: CountyPermitTrend = {
  latestYear: 2024,
  priorYear: 2023,
  latestYearUnits: 260,
  priorYearUnits: 200,
  trendPercent: 30,
};

const EMPLOYMENT: CountyEmploymentSignal = {
  latestYear: 2023,
  avgEmployment: 11871,
  avgWeeklyWage: 958,
  employmentTrendPercent: 2.9,
  wageTrendPercent: 6.9,
};

function stubReaders(signals: {
  migration?: CountyMigrationSignal | null;
  permits?: CountyPermitTrend | null;
  employment?: CountyEmploymentSignal | null;
}) {
  _momentumSignalReaders.getMigrationSignal = async () => signals.migration ?? null;
  _momentumSignalReaders.getPermitTrend = async () => signals.permits ?? null;
  _momentumSignalReaders.getEmploymentSignal = async () => signals.employment ?? null;
}

// ─── getCountyMomentum ───────────────────────────────────────────────────────

describe("getCountyMomentum", () => {
  it("fuses all three signals into a direction-vote composite with full evidence", async () => {
    stubReaders({ migration: MIGRATION, permits: PERMITS, employment: EMPLOYMENT });

    const m = await getCountyMomentum("48", "043");

    expect(m.stateFips).toBe("48");
    expect(m.countyFips).toBe("043");
    expect(m.signalsConsidered).toBe(3);
    expect(m.signalsPresent).toBe(3);
    expect(m.missingSignals).toEqual([]);
    expect(m.compositeUnavailableReason).toBeNull();

    // All three deltas are positive -> +1 each -> +3 of 3, rising.
    expect(m.composite).toMatchObject({ score: 3, outOf: 3, direction: "rising" });
    // The combination rule is stated with the result, not hidden.
    expect(m.composite?.basis).toMatch(/direction votes/i);
    expect(m.composite?.basis).toMatch(/No magnitude weights/i);

    // Per-signal source labels + years.
    const bySignal = Object.fromEntries(m.evidence.map((e) => [e.signal, e]));
    expect(bySignal.migration.source).toMatch(/IRS SOI/);
    expect(bySignal.migration.source).toMatch(/county_migration_summary/);
    expect(bySignal.migration.years).toContain("2223");
    expect(bySignal.permits.source).toMatch(/Census Building Permits/);
    expect(bySignal.permits.years).toBe("2023→2024");
    expect(bySignal.employment.source).toMatch(/BLS QCEW/);
    expect(bySignal.employment.years).toBe("2022→2023");

    // Every number traceable to its source signal, verbatim.
    expect(bySignal.migration.values).toMatchObject({ netReturns: 228, netAgiThousands: 20486 });
    expect(bySignal.permits.values).toMatchObject({
      latestYearUnits: 260,
      priorYearUnits: 200,
      trendPercent: 30,
    });
    expect(bySignal.employment.values).toMatchObject({
      avgEmployment: 11871,
      avgWeeklyWage: 958,
      employmentTrendPercent: 2.9,
      wageTrendPercent: 6.9,
    });
  });

  it("emits a composite from exactly 2 signals and lists the third as missing", async () => {
    stubReaders({ migration: null, permits: PERMITS, employment: EMPLOYMENT });

    const m = await getCountyMomentum("48", "043");

    expect(m.signalsPresent).toBe(2);
    expect(m.composite).toMatchObject({ score: 2, outOf: 2, direction: "rising" });
    expect(m.missingSignals).toHaveLength(1);
    expect(m.missingSignals[0]).toMatchObject({ signal: "migration" });
    expect(m.missingSignals[0].source).toMatch(/IRS SOI/);
    expect(m.missingSignals[0].reason).toMatch(/No ingested/i);
  });

  it("returns partial evidence WITHOUT a composite when only 1 of 3 signals exists", async () => {
    stubReaders({ migration: MIGRATION });

    const m = await getCountyMomentum("48", "043");

    expect(m.signalsPresent).toBe(1);
    expect(m.composite).toBeNull();
    expect(m.compositeUnavailableReason).toMatch(/Only 1 of 3/);
    expect(m.compositeUnavailableReason).toMatch(/overstate/i);
    // The single signal's evidence still passes through untouched.
    expect(m.evidence).toHaveLength(1);
    expect(m.evidence[0].signal).toBe("migration");
    expect(m.evidence[0].values.netReturns).toBe(228);
    // The two absent signals are named, with reasons.
    expect(m.missingSignals.map((s) => s.signal).sort()).toEqual(["employment", "permits"]);
  });

  it("returns an all-missing readout (no composite, no evidence) when nothing is ingested", async () => {
    stubReaders({});

    const m = await getCountyMomentum("48", "043");

    expect(m.signalsPresent).toBe(0);
    expect(m.evidence).toEqual([]);
    expect(m.composite).toBeNull();
    expect(m.missingSignals).toHaveLength(3);
  });

  it("labels opposing votes 'mixed' and all-zero votes 'flat' — never averages into a fake trend", async () => {
    // +1 (migration) and -1 (permits): sum 0 but NOT flat.
    stubReaders({ migration: MIGRATION, permits: { ...PERMITS, trendPercent: -10 } });
    const mixed = await getCountyMomentum("48", "043");
    expect(mixed.composite).toMatchObject({ score: 0, outOf: 2, direction: "mixed" });

    // Exactly-zero deltas on both -> flat.
    stubReaders({
      migration: { ...MIGRATION, netReturns: 0 },
      permits: { ...PERMITS, trendPercent: 0 },
    });
    const flat = await getCountyMomentum("48", "043");
    expect(flat.composite).toMatchObject({ score: 0, outOf: 2, direction: "flat" });

    // Both negative -> cooling.
    stubReaders({
      migration: { ...MIGRATION, netReturns: -50 },
      permits: { ...PERMITS, trendPercent: -10 },
    });
    const cooling = await getCountyMomentum("48", "043");
    expect(cooling.composite).toMatchObject({ score: -2, outOf: 2, direction: "cooling" });
  });
});

// ─── Acquisition radar wiring ────────────────────────────────────────────────

const fakeConfig: any = {
  id: 1,
  organizationId: 42,
  name: "Default",
  isActive: true,
  weights: {
    priceVsAssessed: 25,
    daysOnMarket: 15,
    sellerMotivation: 20,
    marketVelocity: 15,
    comparableSpreads: 15,
    environmentalRisk: -10,
    ownerSignals: 20,
  },
  thresholds: {
    hotOpportunity: 80,
    goodOpportunity: 60,
    minimumScore: 40,
    maxDaysOnMarket: 365,
    minPriceDiscount: 10,
    maxFloodRisk: 50,
  },
};

// No lat/lng on purpose: fetchEnrichedData short-circuits, so no broker/db.
const parcel = {
  apn: "9999-0001",
  county: "Brewster", // TX:BREWSTER -> 48/043 in the census FIPS map
  state: "TX",
  listPrice: 5000,
  assessedValue: 12000,
  acreage: 10,
};

describe("acquisitionRadar county momentum wiring", () => {
  it("says 'not checked' when the parcel has no state/county", async () => {
    const ctx = await acquisitionRadar.fetchCountyMomentum(undefined, undefined);
    expect(ctx.status).toBe("unavailable");
    expect(ctx.reason).toMatch(/not checked/i);
    expect(ctx.momentum).toBeUndefined();
  });

  it("says 'not checked' for a county outside the FIPS map — never a fabricated neutral", async () => {
    const ctx = await acquisitionRadar.fetchCountyMomentum("ZZ", "Nowhere");
    expect(ctx.status).toBe("unavailable");
    expect(ctx.reason).toMatch(/No FIPS mapping/);
  });

  it("reports unavailable (with reason) when no signals are ingested for a known county", async () => {
    stubReaders({});
    const ctx = await acquisitionRadar.fetchCountyMomentum("TX", "Brewster");
    expect(ctx.status).toBe("unavailable");
    expect(ctx.reason).toMatch(/No ingested county market signals/);
  });

  it("surfaces the fused momentum (with evidence) for a known county with >=2 signals", async () => {
    stubReaders({ permits: PERMITS, employment: EMPLOYMENT });
    const ctx = await acquisitionRadar.fetchCountyMomentum("TX", "Brewster");
    expect(ctx.status).toBe("available");
    expect(ctx.momentum?.composite).toMatchObject({ score: 2, outOf: 2, direction: "rising" });
    expect(ctx.momentum?.evidence.map((e) => e.signal).sort()).toEqual([
      "employment",
      "permits",
    ]);
  });

  it("scoreParcel: momentum is additive — score identical with and without it, and absence is stated", async () => {
    stubReaders({});
    const without = await acquisitionRadar.scoreParcel(parcel, fakeConfig);
    expect(without.countyMomentum.status).toBe("unavailable");
    expect(without.explanation).toMatch(/County momentum unavailable/);
    // Not "checked and neutral" — the reason is carried.
    expect(without.explanation).toMatch(/No ingested county market signals/);

    stubReaders({ migration: MIGRATION, permits: PERMITS, employment: EMPLOYMENT });
    const withMomentum = await acquisitionRadar.scoreParcel(parcel, fakeConfig);
    expect(withMomentum.countyMomentum.status).toBe("available");
    expect(withMomentum.explanation).toMatch(/County momentum: rising/);
    expect(withMomentum.explanation).toMatch(/IRS SOI/);

    // The numeric score never moves: county-level context, not a hidden weight.
    expect(withMomentum.score).toBe(without.score);
  });

  it("scoreParcel: partial evidence (1 signal) is passed through honestly with no composite", async () => {
    stubReaders({ permits: PERMITS });
    const result = await acquisitionRadar.scoreParcel(parcel, fakeConfig);
    expect(result.countyMomentum.status).toBe("available");
    expect(result.countyMomentum.momentum?.composite).toBeNull();
    expect(result.explanation).toMatch(/partial evidence only/);
    expect(result.explanation).toMatch(/1 of 3 signals/);
  });

  it("scoreParcel is null-safe when the signal readers throw — scoring still completes", async () => {
    _momentumSignalReaders.getMigrationSignal = async () => {
      throw new Error("db exploded");
    };
    _momentumSignalReaders.getPermitTrend = async () => {
      throw new Error("db exploded");
    };
    _momentumSignalReaders.getEmploymentSignal = async () => {
      throw new Error("db exploded");
    };

    const result = await acquisitionRadar.scoreParcel(parcel, fakeConfig);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.countyMomentum.status).toBe("unavailable");
    expect(result.countyMomentum.reason).toMatch(/lookup failed/i);
    expect(result.explanation).toMatch(/County momentum unavailable/);
  });
});
