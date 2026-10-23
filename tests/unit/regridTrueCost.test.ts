/**
 * D1a — Regrid true-cost correction.
 *
 * Regrid bills 10¢ per record returned on the Standard schema and 15¢ on
 * Premium; a call that returns no record is not billed (source and date on
 * REGRID_CENTS_PER_RECORD in regrid-provider.ts). The provider's cost table
 * sat at 3–8¢ — below the floor — so every paid Regrid lookup was metered at
 * less than it cost AcreOS. These tests pin the floor to the named constant
 * (a future drift edits the constant and its source line, visibly) and pin
 * the per-record rule both ways: a returned record is billed at the floor, an
 * empty answer or a free-source answer is billed at 0.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  parcel: { found: true, source: "regrid", parcel: { apn: "R-1", data: { owner: "X" } } } as Record<string, unknown>,
  comps: [] as unknown[],
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/parcel", () => ({
  lookupParcelByCoordinates: async () => h.parcel,
  lookupParcelByAPN: async () => h.parcel,
}));
vi.mock("../../server/services/comps", () => ({
  getComparableProperties: async () => ({ success: true, comps: h.comps }),
}));

import {
  regridProvider,
  REGRID_CENTS_PER_RECORD,
  REGRID_CATEGORY_SCHEMA,
} from "../../server/services/providers/regrid-provider";

const at = { type: "coordinates" as const, latitude: 35, longitude: -86 };
const ctx = { apiKeyOverride: "test-key" };

describe("Regrid cost table is the published per-record floor", () => {
  it("names the floor: 10¢ Standard, 15¢ Premium", () => {
    expect(REGRID_CENTS_PER_RECORD).toEqual({ standard: 10, premium: 15 });
  });

  it("prices each category at its schema's floor", () => {
    expect(regridProvider.costPerLookupCents("parcel_data")).toBe(10);
    expect(regridProvider.costPerLookupCents("comps")).toBe(15);
    expect(regridProvider.costPerLookupCents("owner_info")).toBe(15);
    expect(regridProvider.costPerLookupCents("valuation")).toBe(15);
  });

  it("covers every category the provider serves, and none is below the floor", () => {
    for (const category of regridProvider.categories) {
      expect(REGRID_CATEGORY_SCHEMA).toHaveProperty(category);
      expect(regridProvider.costPerLookupCents(category)).toBeGreaterThanOrEqual(REGRID_CENTS_PER_RECORD.standard);
    }
    // An unlisted category falls back to the floor, never below it.
    expect(regridProvider.costPerLookupCents("environmental")).toBe(REGRID_CENTS_PER_RECORD.standard);
  });
});

describe("billed per record returned", () => {
  beforeEach(() => {
    h.parcel = { found: true, source: "regrid", parcel: { apn: "R-1", data: { owner: "X" } } };
    h.comps = [];
  });

  it("a record Regrid returned costs the floor", async () => {
    const r = await regridProvider.lookup("parcel_data", at, ctx);
    expect(r.costCents).toBe(10);
    const o = await regridProvider.lookup("owner_info", at, ctx);
    expect(o.costCents).toBe(15);
  });

  it("an empty answer is not billed", async () => {
    h.parcel = { found: false, source: "regrid", parcel: null };
    expect((await regridProvider.lookup("parcel_data", at, ctx)).costCents).toBe(0);
    expect((await regridProvider.lookup("parcel_data", { type: "apn", apn: "1", state: "TN", county: "Wilson" }, ctx)).costCents).toBe(0);
    expect((await regridProvider.lookup("valuation", at, ctx)).costCents).toBe(0);
  });

  it("a comps search that returned no records is not billed; one that returned records is", async () => {
    expect((await regridProvider.lookup("comps", at, ctx)).costCents).toBe(0);
    h.comps = [{ apn: "C-1" }];
    expect((await regridProvider.lookup("comps", at, ctx)).costCents).toBe(15);
  });

  it("an answer from a free source (county GIS) is not billed as a Regrid call", async () => {
    h.parcel = { found: true, source: "county_gis", parcel: { apn: "G-1", data: {} } };
    expect((await regridProvider.lookup("parcel_data", at, ctx)).costCents).toBe(0);
  });
});
