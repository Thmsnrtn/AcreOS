/**
 * Per-category cache TTL selection (Iris/Quinn/Lena lens).
 * Pins the volatility-tiered TTLs so a careless edit can't silently start
 * serving stale tax data as fresh or re-hammering stable federal endpoints.
 */
import { describe, it, expect } from "vitest";
import {
  cacheTtlMs,
  DAY_MS,
  ONE_YEAR_MS,
  DEFAULT_CACHE_TTL_MS,
} from "./cache-ttl";

describe("cacheTtlMs — per-category volatility tiers", () => {
  it("flood/wetlands/land-cover (environmental) cache ~90d", () => {
    expect(cacheTtlMs("environmental")).toBe(90 * DAY_MS);
  });

  it("demographics cache ~90d", () => {
    expect(cacheTtlMs("demographics")).toBe(90 * DAY_MS);
  });

  it("parcel / owner / valuation cache ~30d", () => {
    expect(cacheTtlMs("parcel_data")).toBe(30 * DAY_MS);
    expect(cacheTtlMs("owner_info")).toBe(30 * DAY_MS);
    expect(cacheTtlMs("valuation")).toBe(30 * DAY_MS);
  });

  it("unmapped category falls back to the default (30d)", () => {
    // @ts-expect-error — exercising the fallback path with an off-map value
    expect(cacheTtlMs("not_a_category")).toBe(DEFAULT_CACHE_TTL_MS);
  });

  it("soils + PLSS source names get the ~1yr TTL regardless of category", () => {
    expect(cacheTtlMs("environmental", "USDA SSURGO")).toBe(ONE_YEAR_MS);
    expect(cacheTtlMs("environmental", "USDA WSS")).toBe(ONE_YEAR_MS);
    expect(cacheTtlMs("parcel_data", "BLM PLSS")).toBe(ONE_YEAR_MS);
  });

  it("a non-long-TTL source does not extend the category TTL", () => {
    // FEMA flood is 90d (environmental), not 1yr.
    expect(cacheTtlMs("environmental", "FEMA NFHL")).toBe(90 * DAY_MS);
  });
});
