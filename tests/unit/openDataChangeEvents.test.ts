/**
 * County-signal temporal change events (ruling #9 wave 3).
 *
 * Covers the pure rule detectors (migration sign-flip / ≥50% swing, permit
 * ≥2x / ≤0.5x, employment-trend ±10% crossing), the honesty rules
 * (suppressed years never produce events, no percent against zero, first-ever
 * year is not a change), the scope-ref construction, and the best-effort
 * emission glue wired into the ETL upserts — all via the injected
 * `changeEventsRuntime` seam, no database needed.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  changeEventsRuntime,
  countyScopeRef,
  priorFilingYearLabel,
  detectMigrationChangeEvent,
  detectPermitChangeEvent,
  detectEmploymentTrendCrossing,
  emitMigrationChangeEvent,
  emitPermitChangeEvent,
  emitEmploymentChangeEvent,
  irsSoiMigrationEtlHandler,
  censusBpsPermitsEtlHandler,
  blsQcewEmploymentEtlHandler,
  type OpenDataChangeEventRow,
  type CountyMigrationUpsertRow,
  type BpsCountyPermitRow,
  type QcewCountyRow,
} from "../../server/services/etlHandlers";

const NOW = new Date("2026-07-28T00:00:00Z");

// ─── Runtime seam save/restore ──────────────────────────────────────────────

const originalRuntime = { ...changeEventsRuntime };

function injectRuntime(overrides: Partial<typeof changeEventsRuntime>): OpenDataChangeEventRow[] {
  const captured: OpenDataChangeEventRow[] = [];
  changeEventsRuntime.now = () => NOW;
  changeEventsRuntime.insert = async (event) => {
    captured.push(event);
  };
  changeEventsRuntime.loadPriorMigration = async () => null;
  changeEventsRuntime.loadPermitYear = async () => null;
  changeEventsRuntime.loadEmploymentYear = async () => null;
  Object.assign(changeEventsRuntime, overrides);
  return captured;
}

afterEach(() => {
  Object.assign(changeEventsRuntime, originalRuntime);
});

// ─── Scope refs ──────────────────────────────────────────────────────────────

describe("countyScopeRef", () => {
  it("builds ST/countyslug from state FIPS + published county name", () => {
    expect(countyScopeRef("48", "Travis County", "453")).toBe("TX/travis");
    expect(countyScopeRef("01", "Autauga County", "001")).toBe("AL/autauga");
    expect(countyScopeRef("12", "St. Lucie County", "111")).toBe("FL/st-lucie");
  });

  it("falls back to the county FIPS when the upstream publishes no name (QCEW)", () => {
    expect(countyScopeRef("48", null, "453")).toBe("TX/453");
  });

  it("returns null for an unknown state FIPS — no event rather than a guess", () => {
    expect(countyScopeRef("99", "Nowhere County", "001")).toBeNull();
  });
});

describe("priorFilingYearLabel", () => {
  it("computes the consecutive prior filing-year pair label", () => {
    expect(priorFilingYearLabel("2324")).toBe("2223");
    expect(priorFilingYearLabel("2001")).toBe("1900");
  });

  it("returns null on junk labels", () => {
    expect(priorFilingYearLabel("23")).toBeNull();
    expect(priorFilingYearLabel("abcd")).toBeNull();
  });
});

// ─── Migration rules ─────────────────────────────────────────────────────────

describe("detectMigrationChangeEvent", () => {
  const base = { scopeRef: "TX/travis", detectedAt: NOW };

  it("emits notable on an inflow→outflow sign flip, narrative from real values", () => {
    const event = detectMigrationChangeEvent({
      ...base,
      prev: { filingYear: "2223", netReturns: 1204 },
      next: { filingYear: "2324", netReturns: -312 },
    });
    expect(event).toMatchObject({
      category: "migration",
      scopeType: "county",
      scopeRef: "TX/travis",
      field: "netReturns",
      previousValue: "1204",
      newValue: "-312",
      // "2223" covers tax years 2022→2023 — previous knowledge as-of end 2023.
      previousAsOf: new Date(Date.UTC(2023, 11, 31)),
      source: "irs_soi_migration_v1",
      severity: "notable",
      detectedAt: NOW,
    });
    expect(event?.narrative).toBe(
      "IRS migration for TX/travis flipped from net inflow (+1,204 returns) to net outflow (-312) in filing year 2324",
    );
  });

  it("emits notable on the reverse outflow→inflow flip", () => {
    const event = detectMigrationChangeEvent({
      ...base,
      prev: { filingYear: "2223", netReturns: -450 },
      next: { filingYear: "2324", netReturns: 90 },
    });
    expect(event?.severity).toBe("notable");
    expect(event?.narrative).toBe(
      "IRS migration for TX/travis flipped from net outflow (-450 returns) to net inflow (+90) in filing year 2324",
    );
  });

  it("emits info on a ≥50% same-sign swing", () => {
    const event = detectMigrationChangeEvent({
      ...base,
      prev: { filingYear: "2223", netReturns: 800 },
      next: { filingYear: "2324", netReturns: 1300 },
    });
    expect(event?.severity).toBe("info");
    expect(event?.narrative).toBe(
      "IRS net migration for TX/travis moved from +800 to +1,300 returns (+62.5%) between filing years 2223 and 2324",
    );
  });

  it("emits info at exactly 50%, both directions", () => {
    expect(
      detectMigrationChangeEvent({
        ...base,
        prev: { filingYear: "2223", netReturns: 800 },
        next: { filingYear: "2324", netReturns: 1200 },
      })?.severity,
    ).toBe("info");
    expect(
      detectMigrationChangeEvent({
        ...base,
        prev: { filingYear: "2223", netReturns: -800 },
        next: { filingYear: "2324", netReturns: -400 },
      })?.severity,
    ).toBe("info");
  });

  it("stays silent below 50%", () => {
    expect(
      detectMigrationChangeEvent({
        ...base,
        prev: { filingYear: "2223", netReturns: 800 },
        next: { filingYear: "2324", netReturns: 1000 },
      }),
    ).toBeNull();
  });

  it("never emits when either year is IRS-suppressed (null)", () => {
    expect(
      detectMigrationChangeEvent({
        ...base,
        prev: { filingYear: "2223", netReturns: null },
        next: { filingYear: "2324", netReturns: 500 },
      }),
    ).toBeNull();
    expect(
      detectMigrationChangeEvent({
        ...base,
        prev: { filingYear: "2223", netReturns: 500 },
        next: { filingYear: "2324", netReturns: null },
      }),
    ).toBeNull();
  });

  it("never computes a percent against a zero prior year", () => {
    expect(
      detectMigrationChangeEvent({
        ...base,
        prev: { filingYear: "2223", netReturns: 0 },
        next: { filingYear: "2324", netReturns: 900 },
      }),
    ).toBeNull();
  });
});

// ─── Permit rules ────────────────────────────────────────────────────────────

describe("detectPermitChangeEvent", () => {
  const base = { scopeRef: "AL/autauga", detectedAt: NOW };

  it("emits notable when units at least double", () => {
    const event = detectPermitChangeEvent({
      ...base,
      prev: { year: 2023, totalUnits: 120 },
      next: { year: 2024, totalUnits: 260 },
    });
    expect(event).toMatchObject({
      category: "permits",
      severity: "notable",
      field: "totalUnits",
      previousValue: "120",
      newValue: "260",
      previousAsOf: new Date(Date.UTC(2023, 11, 31)),
      source: "census_bps_permits_v1",
    });
    expect(event?.narrative).toBe(
      "Census BPS permitted units for AL/autauga went from 120 (2023) to 260 (2024) — 2.17x year over year",
    );
  });

  it("emits notable when units at least halve", () => {
    const event = detectPermitChangeEvent({
      ...base,
      prev: { year: 2023, totalUnits: 400 },
      next: { year: 2024, totalUnits: 180 },
    });
    expect(event?.severity).toBe("notable");
    expect(event?.narrative).toContain("400 (2023) to 180 (2024)");
    expect(event?.narrative).toContain("0.45x");
  });

  it("emits at exactly 2x and exactly 0.5x", () => {
    expect(
      detectPermitChangeEvent({
        ...base,
        prev: { year: 2023, totalUnits: 100 },
        next: { year: 2024, totalUnits: 200 },
      }),
    ).not.toBeNull();
    expect(
      detectPermitChangeEvent({
        ...base,
        prev: { year: 2023, totalUnits: 200 },
        next: { year: 2024, totalUnits: 100 },
      }),
    ).not.toBeNull();
  });

  it("stays silent inside the (0.5x, 2x) band", () => {
    expect(
      detectPermitChangeEvent({
        ...base,
        prev: { year: 2023, totalUnits: 100 },
        next: { year: 2024, totalUnits: 150 },
      }),
    ).toBeNull();
  });

  it("never emits when either year is zero — no ratio against zero", () => {
    expect(
      detectPermitChangeEvent({
        ...base,
        prev: { year: 2023, totalUnits: 0 },
        next: { year: 2024, totalUnits: 50 },
      }),
    ).toBeNull();
    expect(
      detectPermitChangeEvent({
        ...base,
        prev: { year: 2023, totalUnits: 50 },
        next: { year: 2024, totalUnits: 0 },
      }),
    ).toBeNull();
  });

  it("never compares non-consecutive years", () => {
    expect(
      detectPermitChangeEvent({
        ...base,
        prev: { year: 2021, totalUnits: 100 },
        next: { year: 2024, totalUnits: 400 },
      }),
    ).toBeNull();
  });
});

// ─── Employment rules ────────────────────────────────────────────────────────

describe("detectEmploymentTrendCrossing", () => {
  const base = { scopeRef: "TX/453", detectedAt: NOW };

  it("emits info when the YoY trend crosses +10% upward", () => {
    // 100000 → 108000 = +8.0%; 108000 → 121000 = +12.037…%
    const event = detectEmploymentTrendCrossing({
      ...base,
      oldest: { year: 2022, avgEmployment: 100000 },
      middle: { year: 2023, avgEmployment: 108000 },
      newest: { year: 2024, avgEmployment: 121000 },
    });
    expect(event).toMatchObject({
      category: "employment",
      severity: "info",
      field: "employmentTrendPercent",
      previousValue: "8.0",
      newValue: "12.0",
      previousAsOf: new Date(Date.UTC(2023, 11, 31)),
      source: "bls_qcew_employment_v1",
    });
    expect(event?.narrative).toBe(
      "BLS QCEW employment trend for TX/453 crossed +10%: +8.0% (2022→2023) to +12.0% (2023→2024)",
    );
  });

  it("emits info when the trend crosses back below +10%", () => {
    // +12.0% then +8.0%
    const event = detectEmploymentTrendCrossing({
      ...base,
      oldest: { year: 2022, avgEmployment: 100000 },
      middle: { year: 2023, avgEmployment: 112000 },
      newest: { year: 2024, avgEmployment: 120960 },
    });
    expect(event?.previousValue).toBe("12.0");
    expect(event?.newValue).toBe("8.0");
    expect(event?.narrative).toContain("crossed +10%");
  });

  it("emits info when the trend crosses -10% downward", () => {
    // -8.0% then -12.0%
    const event = detectEmploymentTrendCrossing({
      ...base,
      oldest: { year: 2022, avgEmployment: 100000 },
      middle: { year: 2023, avgEmployment: 92000 },
      newest: { year: 2024, avgEmployment: 80960 },
    });
    expect(event?.severity).toBe("info");
    expect(event?.narrative).toContain("crossed -10%");
  });

  it("stays silent when no ±10% line is crossed", () => {
    // +2.0% then +9.0%
    expect(
      detectEmploymentTrendCrossing({
        ...base,
        oldest: { year: 2022, avgEmployment: 100000 },
        middle: { year: 2023, avgEmployment: 102000 },
        newest: { year: 2024, avgEmployment: 111180 },
      }),
    ).toBeNull();
  });

  it("never emits when any of the three years is BLS-suppressed (null)", () => {
    expect(
      detectEmploymentTrendCrossing({
        ...base,
        oldest: { year: 2022, avgEmployment: 100000 },
        middle: { year: 2023, avgEmployment: null },
        newest: { year: 2024, avgEmployment: 121000 },
      }),
    ).toBeNull();
  });

  it("never computes a percent against a zero denominator", () => {
    expect(
      detectEmploymentTrendCrossing({
        ...base,
        oldest: { year: 2022, avgEmployment: 0 },
        middle: { year: 2023, avgEmployment: 5000 },
        newest: { year: 2024, avgEmployment: 12000 },
      }),
    ).toBeNull();
  });

  it("never compares non-consecutive years", () => {
    expect(
      detectEmploymentTrendCrossing({
        ...base,
        oldest: { year: 2020, avgEmployment: 100000 },
        middle: { year: 2023, avgEmployment: 108000 },
        newest: { year: 2024, avgEmployment: 121000 },
      }),
    ).toBeNull();
  });
});

// ─── Emission glue via injected runtime (no DB) ─────────────────────────────

const MIGRATION_ROW: CountyMigrationUpsertRow = {
  stateFips: "48",
  countyFips: "453",
  countyName: "Travis County",
  filingYear: "2324",
  inflowReturns: 100,
  inflowIndividuals: 200,
  inflowAgiThousands: 9000,
  outflowReturns: 412,
  outflowIndividuals: 600,
  outflowAgiThousands: 12000,
  netReturns: -312,
  netAgiThousands: -3000,
};

describe("emitMigrationChangeEvent (glue)", () => {
  it("loads the consecutive prior filing year and inserts the detected event", async () => {
    const priorRequests: Array<[string, string, string]> = [];
    const captured = injectRuntime({
      loadPriorMigration: async (s, c, fy) => {
        priorRequests.push([s, c, fy]);
        return { filingYear: "2223", netReturns: 1204 };
      },
    });
    await emitMigrationChangeEvent(MIGRATION_ROW);
    expect(priorRequests).toEqual([["48", "453", "2223"]]);
    expect(captured).toHaveLength(1);
    expect(captured[0].scopeRef).toBe("TX/travis");
    expect(captured[0].severity).toBe("notable");
    expect(captured[0].narrative).toBe(
      "IRS migration for TX/travis flipped from net inflow (+1,204 returns) to net outflow (-312) in filing year 2324",
    );
  });

  it("first-ever year for a county is not a change", async () => {
    const captured = injectRuntime({ loadPriorMigration: async () => null });
    await emitMigrationChangeEvent(MIGRATION_ROW);
    expect(captured).toHaveLength(0);
  });

  it("a suppressed prior year never produces an event", async () => {
    const captured = injectRuntime({
      loadPriorMigration: async () => ({ filingYear: "2223", netReturns: null }),
    });
    await emitMigrationChangeEvent(MIGRATION_ROW);
    expect(captured).toHaveLength(0);
  });

  it("swallows insert failures — emission is best-effort", async () => {
    injectRuntime({
      loadPriorMigration: async () => ({ filingYear: "2223", netReturns: 1204 }),
      insert: async () => {
        throw new Error("db down");
      },
    });
    await expect(emitMigrationChangeEvent(MIGRATION_ROW)).resolves.toBeUndefined();
  });
});

describe("emitPermitChangeEvent (glue)", () => {
  const row: BpsCountyPermitRow = {
    stateFips: "01",
    countyFips: "001",
    countyName: "Autauga County",
    year: 2024,
    totalUnits: 640,
    singleFamilyUnits: 600,
    multiFamilyUnits: 40,
  };

  it("emits notable on a ≥2x jump against the prior ingested year", async () => {
    const captured = injectRuntime({
      loadPermitYear: async (_s, _c, year) => (year === 2023 ? { year: 2023, totalUnits: 260 } : null),
    });
    await emitPermitChangeEvent(row);
    expect(captured).toHaveLength(1);
    expect(captured[0].scopeRef).toBe("AL/autauga");
    expect(captured[0].narrative).toContain("260 (2023) to 640 (2024)");
  });

  it("first-ever year is not a change", async () => {
    const captured = injectRuntime({ loadPermitYear: async () => null });
    await emitPermitChangeEvent(row);
    expect(captured).toHaveLength(0);
  });
});

describe("emitEmploymentChangeEvent (glue)", () => {
  const row: QcewCountyRow = {
    stateFips: "48",
    countyFips: "453",
    year: 2024,
    avgEmployment: 121000,
    avgWeeklyWage: 1800,
    establishments: 52000,
  };

  it("loads the two prior consecutive years and emits on a +10% crossing", async () => {
    const captured = injectRuntime({
      loadEmploymentYear: async (_s, _c, year) =>
        year === 2023
          ? { year: 2023, avgEmployment: 108000 }
          : year === 2022
            ? { year: 2022, avgEmployment: 100000 }
            : null,
    });
    await emitEmploymentChangeEvent(row);
    expect(captured).toHaveLength(1);
    // QCEW publishes no county name — FIPS stands in as the slug, never a guess.
    expect(captured[0].scopeRef).toBe("TX/453");
    expect(captured[0].field).toBe("employmentTrendPercent");
  });

  it("a suppressed newly ingested year never produces an event", async () => {
    const captured = injectRuntime({
      loadEmploymentYear: async () => ({ year: 2023, avgEmployment: 108000 }),
    });
    await emitEmploymentChangeEvent({ ...row, avgEmployment: null });
    expect(captured).toHaveLength(0);
  });

  it("only two ingested years (no prior trend) is not a crossing", async () => {
    const captured = injectRuntime({
      loadEmploymentYear: async (_s, _c, year) =>
        year === 2023 ? { year: 2023, avgEmployment: 108000 } : null,
    });
    await emitEmploymentChangeEvent(row);
    expect(captured).toHaveLength(0);
  });
});

// ─── Handler upsert wiring (fake tx, no DB) ─────────────────────────────────

function fakeTx({ existing = false }: { existing?: boolean } = {}) {
  const inserted: unknown[] = [];
  return {
    _inserted: inserted,
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (existing ? [{ id: 1 }] : []) }),
      }),
    }),
    insert: () => ({
      values: async (v: unknown) => {
        inserted.push(v);
      },
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  };
}

describe("ETL upsert wiring", () => {
  it("migration upsert of a NEW year emits an event alongside the row insert", async () => {
    const captured = injectRuntime({
      loadPriorMigration: async () => ({ filingYear: "2223", netReturns: 1204 }),
    });
    const tx = fakeTx();
    const result = await irsSoiMigrationEtlHandler.upsert(
      { externalId: "irs_soi_48453_2324", updatedAt: "2324", payload: MIGRATION_ROW as unknown as Record<string, unknown> },
      tx as never,
    );
    expect(result.action).toBe("inserted");
    expect(tx._inserted).toHaveLength(1); // the county_migration_summary row
    expect(captured).toHaveLength(1);
    expect(captured[0].category).toBe("migration");
  });

  it("re-ingesting an existing year updates the row and emits nothing", async () => {
    const captured = injectRuntime({
      loadPriorMigration: async () => ({ filingYear: "2223", netReturns: 1204 }),
    });
    const tx = fakeTx({ existing: true });
    const result = await irsSoiMigrationEtlHandler.upsert(
      { externalId: "irs_soi_48453_2324", updatedAt: "2324", payload: MIGRATION_ROW as unknown as Record<string, unknown> },
      tx as never,
    );
    expect(result.action).toBe("updated");
    expect(captured).toHaveLength(0);
  });

  it("an emission failure never fails the upsert (DLQ/watermark stay clean)", async () => {
    injectRuntime({
      loadPriorMigration: async () => {
        throw new Error("prior-year lookup exploded");
      },
    });
    const tx = fakeTx();
    await expect(
      irsSoiMigrationEtlHandler.upsert(
        { externalId: "irs_soi_48453_2324", updatedAt: "2324", payload: MIGRATION_ROW as unknown as Record<string, unknown> },
        tx as never,
      ),
    ).resolves.toEqual({ action: "inserted" });
  });

  it("permits + employment upserts of NEW years emit through the same seam", async () => {
    const captured = injectRuntime({
      loadPermitYear: async (_s, _c, year) => (year === 2023 ? { year: 2023, totalUnits: 100 } : null),
      loadEmploymentYear: async (_s, _c, year) =>
        year === 2023
          ? { year: 2023, avgEmployment: 108000 }
          : year === 2022
            ? { year: 2022, avgEmployment: 100000 }
            : null,
    });

    const permitRow: BpsCountyPermitRow = {
      stateFips: "01",
      countyFips: "001",
      countyName: "Autauga County",
      year: 2024,
      totalUnits: 210,
      singleFamilyUnits: 210,
      multiFamilyUnits: 0,
    };
    await censusBpsPermitsEtlHandler.upsert(
      { externalId: "bps_01001_2024", updatedAt: "2024", payload: permitRow as unknown as Record<string, unknown> },
      fakeTx() as never,
    );

    const qcewRow: QcewCountyRow = {
      stateFips: "48",
      countyFips: "453",
      year: 2024,
      avgEmployment: 121000,
      avgWeeklyWage: 1800,
      establishments: 52000,
    };
    await blsQcewEmploymentEtlHandler.upsert(
      { externalId: "qcew_48453_2024", updatedAt: "2024", payload: qcewRow as unknown as Record<string, unknown> },
      fakeTx() as never,
    );

    expect(captured.map((e) => e.category)).toEqual(["permits", "employment"]);
    expect(captured[0].severity).toBe("notable"); // 100 → 210 = 2.10x
    expect(captured[1].severity).toBe("info"); // +8.0% → +12.0% crosses +10%
  });
});
