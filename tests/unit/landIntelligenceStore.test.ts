/**
 * Land Intelligence Report store — staleness + cache-key tests (Iyari #2).
 *
 * Locks in the store-read/store-write contract that wraps the fusion
 * COMPUTATION without changing the fusion math:
 *   1. parcelKeyFor is stable + identity-correct (apn wins; geo fallback;
 *      lat/lng rounding tolerates float jitter; org/parcel separation).
 *   2. isReportFresh respects the report-level staleAfter policy.
 *   3. staleFields flags fields past their per-field horizon (and missing
 *      provenance = stale) so a future surgical refresh knows what to re-pull.
 *
 * These exercise the pure helpers (no DB) — the read/write DB paths are
 * best-effort wrappers around these decisions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Mock the schema to sentinels + a controllable in-memory db fake so we can
// import the store without a live DATABASE_URL and assert the read/write paths.
// Factories must be self-contained — vi.mock is hoisted above top-level vars.
// ─────────────────────────────────────────────────────────────────────────────
vi.mock("@shared/schema", () => ({
  landIntelligenceReports: {
    __table: "land_intelligence_reports",
    parcelKey: "parcel_key",
    organizationId: "organization_id",
    computedAt: "computed_at",
  },
}));

const dbState: {
  rows: any[];
  inserts: any[];
  deleteCalls: number;
  throwOnInsert: boolean;
  throwOnSelect: boolean;
} = { rows: [], inserts: [], deleteCalls: 0, throwOnInsert: false, throwOnSelect: false };

vi.mock("../../server/db", () => {
  const builder = () => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: async () => {
        if (dbState.throwOnSelect) throw new Error("simulated select failure");
        return dbState.rows;
      },
    };
    return chain;
  };
  return {
    db: {
      select: () => builder(),
      insert: () => ({
        values: async (vals: any) => {
          if (dbState.throwOnInsert) throw new Error("simulated insert failure");
          dbState.inserts.push(vals);
          return [];
        },
      }),
      delete: () => ({
        where: async () => {
          dbState.deleteCalls += 1;
          return [];
        },
      }),
    },
  };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  parcelKeyFor,
  isReportFresh,
  staleFields,
  readStoredReport,
  writeStoredReport,
  REPORT_STALE_AFTER_MS,
  FIELD_STALE_AFTER_MS,
} from "../../server/services/data-cache/land-intelligence-store";

beforeEach(() => {
  dbState.rows = [];
  dbState.inserts = [];
  dbState.deleteCalls = 0;
  dbState.throwOnInsert = false;
  dbState.throwOnSelect = false;
});

describe("parcelKeyFor", () => {
  it("is deterministic for the same identity", () => {
    const id = { apn: "123-45-678", state: "AZ", county: "Cochise" };
    expect(parcelKeyFor(id)).toBe(parcelKeyFor({ ...id }));
  });

  it("uses apn when present and is case/space-insensitive on identity parts", () => {
    const a = parcelKeyFor({ apn: " 123-45-678 ", state: "az", county: " Cochise " });
    const b = parcelKeyFor({ apn: "123-45-678", state: "AZ", county: "cochise" });
    expect(a).toBe(b);
  });

  it("distinguishes different parcels", () => {
    const a = parcelKeyFor({ apn: "111", state: "AZ", county: "Cochise" });
    const b = parcelKeyFor({ apn: "222", state: "AZ", county: "Cochise" });
    expect(a).not.toBe(b);
  });

  it("falls back to rounded geo identity when no apn", () => {
    const base = { state: "TX", county: "Brewster", latitude: 29.123456, longitude: -103.654321, acres: 40 };
    // Jitter below the 5th decimal (~1m) must collapse to the same key.
    const jittered = { ...base, latitude: 29.1234561, longitude: -103.6543209 };
    expect(parcelKeyFor(base)).toBe(parcelKeyFor(jittered));
  });

  it("geo identity changes with materially different coordinates", () => {
    const a = parcelKeyFor({ state: "TX", county: "Brewster", latitude: 29.12345, longitude: -103.65432, acres: 40 });
    const b = parcelKeyFor({ state: "TX", county: "Brewster", latitude: 29.20000, longitude: -103.65432, acres: 40 });
    expect(a).not.toBe(b);
  });

  it("apn identity and geo identity for the same parcel are different keys", () => {
    const withApn = parcelKeyFor({ apn: "999", state: "TX", county: "Brewster", latitude: 29.1, longitude: -103.6 });
    const geoOnly = parcelKeyFor({ state: "TX", county: "Brewster", latitude: 29.1, longitude: -103.6 });
    expect(withApn).not.toBe(geoOnly);
  });
});

describe("isReportFresh", () => {
  const now = new Date("2026-06-06T12:00:00Z");

  it("is fresh when staleAfter is in the future", () => {
    const staleAfter = new Date(now.getTime() + 60_000);
    expect(isReportFresh({ staleAfter }, now)).toBe(true);
  });

  it("is stale at/after the staleAfter boundary", () => {
    const atBoundary = new Date(now.getTime());
    expect(isReportFresh({ staleAfter: atBoundary }, now)).toBe(false);
    const past = new Date(now.getTime() - 1);
    expect(isReportFresh({ staleAfter: past }, now)).toBe(false);
  });

  it("uses the documented 7-day report window", () => {
    expect(REPORT_STALE_AFTER_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("staleFields", () => {
  const now = new Date("2026-06-06T12:00:00Z");
  const fields = ["floodZone", "soil", "environmental"];

  it("treats missing provenance as stale", () => {
    expect(staleFields(null, fields, now)).toEqual(fields);
    expect(staleFields({}, fields, now)).toEqual(fields);
  });

  it("keeps a recently-fetched field fresh", () => {
    const fp = {
      floodZone: { source: "FEMA NFHL", fetchedAt: now.toISOString(), classification: "authoritative" },
    };
    expect(staleFields(fp, ["floodZone"], now)).toEqual([]);
  });

  it("flags a field fetched past its per-field horizon", () => {
    const old = new Date(now.getTime() - (FIELD_STALE_AFTER_MS.environmental + 1));
    const fp = {
      environmental: { source: "EPA ECHO", fetchedAt: old.toISOString(), classification: "authoritative" },
    };
    expect(staleFields(fp, ["environmental"], now)).toEqual(["environmental"]);
  });

  it("flags an unparseable fetchedAt as stale", () => {
    const fp = {
      soil: { source: "USDA SSURGO", fetchedAt: "not-a-date", classification: "authoritative" },
    };
    expect(staleFields(fp, ["soil"], now)).toEqual(["soil"]);
  });

  it("returns only the subset of requested fields that are stale", () => {
    const fp = {
      floodZone: { source: "FEMA NFHL", fetchedAt: now.toISOString(), classification: "authoritative" },
      soil: { source: "USDA SSURGO", fetchedAt: new Date(now.getTime() - (FIELD_STALE_AFTER_MS.soil + 1)).toISOString(), classification: "authoritative" },
    };
    expect(staleFields(fp, ["floodZone", "soil"], now)).toEqual(["soil"]);
  });
});

describe("readStoredReport", () => {
  it("returns the freshest stored row", async () => {
    const row = { id: 1, parcelKey: "k", report: { ok: true }, staleAfter: new Date() };
    dbState.rows = [row];
    const got = await readStoredReport("k", 42);
    expect(got).toBe(row);
  });

  it("returns null on a store miss", async () => {
    dbState.rows = [];
    expect(await readStoredReport("k", 42)).toBeNull();
  });

  it("degrades to null (recompute) on any db error", async () => {
    dbState.throwOnSelect = true;
    expect(await readStoredReport("k", 42)).toBeNull();
  });
});

describe("writeStoredReport", () => {
  const identity = { apn: "123", state: "AZ", county: "Cochise", latitude: 31.5, longitude: -110.3, acres: 40 };
  const report = {
    landIntelligenceScore: 82.6,
    recommendation: "buy_selectively",
    fieldProvenance: {
      floodZone: { source: "FEMA NFHL", fetchedAt: "2026-06-06T00:00:00Z", classification: "authoritative" },
    },
  };

  it("replaces the existing row then inserts (delete-then-insert upsert)", async () => {
    const now = new Date("2026-06-06T12:00:00Z");
    await writeStoredReport({ parcelKey: "k", organizationId: 42, identity, report, now });
    expect(dbState.deleteCalls).toBe(1);
    expect(dbState.inserts).toHaveLength(1);
  });

  it("stamps staleAfter at now + the report window and denormalizes score/recommendation", async () => {
    const now = new Date("2026-06-06T12:00:00Z");
    await writeStoredReport({ parcelKey: "k", organizationId: 42, identity, report, now });
    const ins = dbState.inserts[0];
    expect(ins.computedAt).toEqual(now);
    expect(ins.staleAfter.getTime()).toBe(now.getTime() + REPORT_STALE_AFTER_MS);
    expect(ins.landIntelligenceScore).toBe(83); // rounded from 82.6
    expect(ins.recommendation).toBe("buy_selectively");
    expect(ins.fieldProvenance).toEqual(report.fieldProvenance);
    expect(ins.parcelKey).toBe("k");
    expect(ins.organizationId).toBe(42);
  });

  it("never throws when the db insert fails (best-effort write)", async () => {
    dbState.throwOnInsert = true;
    await expect(
      writeStoredReport({ parcelKey: "k", organizationId: 42, identity, report }),
    ).resolves.toBeUndefined();
  });
});
