/**
 * Land Snapshot → blind-offer wizard prefill mapping (Maren CPO #5).
 *
 * Locks in the honesty contract: only REAL, present, valid fields cross from a
 * parcel into the blind-offer wizard. A missing / empty / non-numeric /
 * non-positive value is OMITTED — never defaulted or fabricated. The parse and
 * build halves must round-trip so the parcel-detail button and the wizard agree
 * on exactly which numbers were carried.
 */

import { describe, it, expect } from "vitest";
import {
  buildBlindOfferPrefillSearch,
  parseSnapshotPrefill,
  type SnapshotPrefill,
} from "@shared/blindOfferPrefill";

describe("buildBlindOfferPrefillSearch — only real fields ride along", () => {
  it("carries state (uppercased), county, and a positive acreage", () => {
    const search = buildBlindOfferPrefillSearch({ state: "az", county: "Mohave", acres: 5 });
    const params = new URLSearchParams(search);
    expect(params.get("state")).toBe("AZ");
    expect(params.get("county")).toBe("Mohave");
    expect(params.get("acres")).toBe("5");
  });

  it("omits acreage that is zero, negative, or non-numeric (never a fabricated default)", () => {
    expect(new URLSearchParams(buildBlindOfferPrefillSearch({ acres: 0 })).has("acres")).toBe(false);
    expect(new URLSearchParams(buildBlindOfferPrefillSearch({ acres: -3 })).has("acres")).toBe(false);
    expect(new URLSearchParams(buildBlindOfferPrefillSearch({ acres: "n/a" })).has("acres")).toBe(false);
    expect(new URLSearchParams(buildBlindOfferPrefillSearch({ acres: null })).has("acres")).toBe(false);
  });

  it("omits empty / whitespace-only state and county", () => {
    const search = buildBlindOfferPrefillSearch({ state: "  ", county: "" });
    const params = new URLSearchParams(search);
    expect(params.has("state")).toBe(false);
    expect(params.has("county")).toBe(false);
  });

  it("accepts a numeric-string acreage from the parcel record", () => {
    const params = new URLSearchParams(buildBlindOfferPrefillSearch({ acres: "12.5" }));
    expect(params.get("acres")).toBe("12.5");
  });

  it("produces an empty query when no real fields are present", () => {
    expect(buildBlindOfferPrefillSearch({})).toBe("");
    expect(buildBlindOfferPrefillSearch({ state: null, county: null, acres: null })).toBe("");
  });
});

describe("parseSnapshotPrefill — only present, valid fields prefill", () => {
  it("parses a full prefill (with or without a leading '?')", () => {
    const expected: SnapshotPrefill = { state: "AZ", county: "Mohave", acres: 5 };
    expect(parseSnapshotPrefill("?state=AZ&county=Mohave&acres=5")).toEqual(expected);
    expect(parseSnapshotPrefill("state=AZ&county=Mohave&acres=5")).toEqual(expected);
  });

  it("uppercases the state code", () => {
    expect(parseSnapshotPrefill("state=tx").state).toBe("TX");
  });

  it("omits a malformed / non-positive acreage rather than defaulting it", () => {
    expect(parseSnapshotPrefill("acres=0").acres).toBeUndefined();
    expect(parseSnapshotPrefill("acres=-5").acres).toBeUndefined();
    expect(parseSnapshotPrefill("acres=abc").acres).toBeUndefined();
    expect(parseSnapshotPrefill("acres=").acres).toBeUndefined();
  });

  it("returns an empty object for an empty query (no fabricated fields)", () => {
    expect(parseSnapshotPrefill("")).toEqual({});
    expect(parseSnapshotPrefill("?")).toEqual({});
  });
});

describe("round-trip — parcel-detail build → wizard parse agree", () => {
  it("a parcel's real fields survive the carry intact", () => {
    const search = buildBlindOfferPrefillSearch({ state: "nm", county: "San Juan", acres: "40" });
    expect(parseSnapshotPrefill(search)).toEqual({ state: "NM", county: "San Juan", acres: 40 });
  });

  it("a parcel missing acreage never gains one through the carry", () => {
    const search = buildBlindOfferPrefillSearch({ state: "FL", county: "Polk", acres: null });
    const parsed = parseSnapshotPrefill(search);
    expect(parsed.acres).toBeUndefined();
    expect(parsed.state).toBe("FL");
    expect(parsed.county).toBe("Polk");
  });
});
