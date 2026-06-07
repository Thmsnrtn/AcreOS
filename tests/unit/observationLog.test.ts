/**
 * Parcel Observation Log unit tests (Iyari — the acorn).
 *
 * Covers the two load-bearing guarantees of observation-log.ts:
 *   1. APPEND-ONLY: the writer only ever calls db.insert(...).values(...) —
 *      never update, never delete.
 *   2. FIRE-AND-FORGET / NEVER-THROWS: a db error inside the insert is
 *      swallowed; recordObservation resolves and does not reject.
 *   3. Batch helper skips null/undefined/"" facts and writes the rest.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Mock the schema to a sentinel so the service's table reference is stable.
// Factory must be self-contained — vi.mock is hoisted above all top-level vars.
// ─────────────────────────────────────────────────────────────────────────────
vi.mock("@shared/schema", () => ({
  parcelObservations: { __table: "parcel_observations" },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Controllable in-memory db fake. Records every insert; can be flipped to
// throw to exercise the never-throws contract.
// ─────────────────────────────────────────────────────────────────────────────
const dbState: {
  inserts: Array<{ target: any; rows: any[] }>;
  updateCalls: number;
  deleteCalls: number;
  throwOnInsert: boolean;
} = { inserts: [], updateCalls: 0, deleteCalls: 0, throwOnInsert: false };

vi.mock("../../server/db", () => ({
  db: {
    insert: (target: any) => ({
      values: async (rows: any) => {
        if (dbState.throwOnInsert) {
          throw new Error("simulated db failure");
        }
        dbState.inserts.push({ target, rows: Array.isArray(rows) ? rows : [rows] });
        return [];
      },
    }),
    update: () => {
      dbState.updateCalls += 1;
      return { set: () => ({ where: async () => [] }) };
    },
    delete: () => {
      dbState.deleteCalls += 1;
      return { where: async () => [] };
    },
  },
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  recordObservation,
  recordObservations,
  recordParcelObservations,
} from "../../server/services/data-cache/observation-log";

beforeEach(() => {
  dbState.inserts = [];
  dbState.updateCalls = 0;
  dbState.deleteCalls = 0;
  dbState.throwOnInsert = false;
});

describe("observation-log — append-only semantics", () => {
  it("records a single observation via INSERT only (never update/delete)", async () => {
    await recordObservation({
      apn: "123-45-678",
      state: "az",
      county: "Cochise",
      field: "owner",
      value: "Jane Smith",
      source: "county_gis",
      organizationId: 7,
    });

    expect(dbState.inserts).toHaveLength(1);
    expect(dbState.updateCalls).toBe(0);
    expect(dbState.deleteCalls).toBe(0);

    const row = dbState.inserts[0].rows[0];
    expect(row.apn).toBe("123-45-678");
    expect(row.state).toBe("AZ"); // normalized upper-case
    expect(row.field).toBe("owner");
    expect(row.value).toBe("Jane Smith");
    expect(row.source).toBe("county_gis");
    expect(row.organizationId).toBe(7);
  });

  it("defaults organizationId to null when not provided", async () => {
    await recordObservation({
      apn: "1",
      state: "TX",
      county: "Webb",
      field: "acres",
      value: 40,
      source: "regrid",
    });
    expect(dbState.inserts[0].rows[0].organizationId).toBeNull();
  });

  it("skips rows missing required identity (no insert)", async () => {
    await recordObservation({
      apn: "",
      state: "TX",
      county: "Webb",
      field: "owner",
      value: "x",
      source: "regrid",
    });
    expect(dbState.inserts).toHaveLength(0);
  });
});

describe("observation-log — never throws (fire-and-forget)", () => {
  it("swallows db errors and resolves to void", async () => {
    dbState.throwOnInsert = true;
    await expect(
      recordObservation({
        apn: "1",
        state: "TX",
        county: "Webb",
        field: "owner",
        value: "x",
        source: "regrid",
      }),
    ).resolves.toBeUndefined();
  });

  it("batch helper swallows db errors and resolves", async () => {
    dbState.throwOnInsert = true;
    await expect(
      recordObservations([
        { apn: "1", state: "TX", county: "Webb", field: "owner", value: "x", source: "regrid" },
      ]),
    ).resolves.toBeUndefined();
  });
});

describe("observation-log — batch / parcel helpers", () => {
  it("recordObservations writes a single multi-row insert", async () => {
    await recordObservations([
      { apn: "1", state: "TX", county: "Webb", field: "owner", value: "A", source: "regrid" },
      { apn: "1", state: "TX", county: "Webb", field: "acres", value: 5, source: "regrid" },
    ]);
    expect(dbState.inserts).toHaveLength(1);
    expect(dbState.inserts[0].rows).toHaveLength(2);
  });

  it("recordParcelObservations skips null/undefined/empty facts", async () => {
    await recordParcelObservations({
      apn: "9",
      state: "NM",
      county: "Luna",
      source: "county_gis",
      organizationId: 3,
      facts: {
        owner: "Real Owner",
        owner_address: "",
        tax_amount: undefined,
        acres: null,
        assessed_value: 12000,
      },
    });
    expect(dbState.inserts).toHaveLength(1);
    const fields = dbState.inserts[0].rows.map((r: any) => r.field).sort();
    expect(fields).toEqual(["assessed_value", "owner"]);
  });

  it("recordParcelObservations is a no-op when every fact is empty", async () => {
    await recordParcelObservations({
      apn: "9",
      state: "NM",
      county: "Luna",
      source: "county_gis",
      facts: { owner: null, acres: undefined, tax_amount: "" },
    });
    expect(dbState.inserts).toHaveLength(0);
  });
});
