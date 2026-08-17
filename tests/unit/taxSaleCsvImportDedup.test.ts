/**
 * Tax-sale import: a duplicate is a duplicate PARCEL, not a repeated number.
 *
 * THE DEFECT. `validateLotRows` deduped on `apn.toUpperCase()` — the APN alone,
 * with no county and no state in the key — against both the existing worksheet
 * and the rest of the file. An APN is unique WITHIN A COUNTY and nowhere else:
 * parcel 123-45-678 exists in Travis County and in Harris County and they are
 * different pieces of land.
 *
 * So a state-level tax-sale list, which is the ordinary shape of one, silently
 * REJECTED the second county's parcel with "Parcel 123-45-678 is already on
 * this worksheet. Not imported twice." The user was told a real parcel was a
 * duplicate, and the row never imported. `county` and `state` are REQUIRED
 * import fields — the whole key was sitting on the row the entire time.
 *
 * The identity now comes from shared/parcel/parcelRef.ts, the one definition of
 * "the same parcel" in this repo.
 */

import { describe, it, expect } from "vitest";
import {
  validateLotRows,
  type ColumnMapping,
} from "../../server/services/taxSaleCsvImport";

const HEADERS = ["apn", "county", "state", "sale type", "total tax owed"];
const MAPPING: ColumnMapping = {
  apn: 0,
  county: 1,
  state: 2,
  saleType: 3,
  totalTaxOwed: 4,
};

/** One CSV row in the shape HEADERS/MAPPING describe. */
const row = (apn: string, county: string, state = "TX"): string[] => [
  apn,
  county,
  state,
  "lien",
  "1000",
];

const validate = (
  rows: string[][],
  existingParcels: Array<{ apn: string; county: string; state: string }> = [],
) => validateLotRows({ headers: HEADERS, rows, mapping: MAPPING, existingParcels });

describe("the fixture really imports (vacuity guard, first)", () => {
  it("a single ordinary row is accepted", () => {
    // Every assertion below distinguishes "accepted" from "rejected as a
    // duplicate". If the fixture were malformed, every row would reject for
    // unrelated reasons and the duplicate tests would pass for the wrong one.
    const out = validate([row("123-45-678", "Travis")]);
    expect(
      out.rejected.map((r) => r.errors.map((e) => e.message).join("; ")),
      "the base fixture does not validate — the tests below prove nothing",
    ).toEqual([]);
    expect(out.valid).toHaveLength(1);
  });
});

describe("the same APN in a DIFFERENT county is a different parcel", () => {
  it("imports both, rather than calling the second a duplicate", () => {
    const out = validate([row("123-45-678", "Travis"), row("123-45-678", "Harris")]);
    expect(
      out.rejected,
      "the second county's parcel was rejected as a duplicate. An APN is only " +
        "unique within a county — this is a real parcel being refused.",
    ).toEqual([]);
    expect(out.valid.map((v) => v.county)).toEqual(["Travis", "Harris"]);
  });

  it("and the worksheet check does the same", () => {
    const out = validate([row("123-45-678", "Harris")], [
      { apn: "123-45-678", county: "Travis", state: "TX" },
    ]);
    expect(out.rejected).toEqual([]);
    expect(out.valid).toHaveLength(1);
  });

  it("the same APN in a different STATE is also a different parcel", () => {
    const out = validate([row("123-45-678", "Travis", "TX"), row("123-45-678", "Travis", "OK")]);
    expect(out.rejected).toEqual([]);
    expect(out.valid).toHaveLength(2);
  });
});

describe("a real duplicate is still caught", () => {
  // The other direction, and the reason the check exists at all: silently
  // skipping a duplicate is how "412 of 500" happens.
  it("the same parcel twice in one file is rejected the second time", () => {
    const out = validate([row("123-45-678", "Travis"), row("123-45-678", "Travis")]);
    expect(out.valid).toHaveLength(1);
    expect(out.rejected).toHaveLength(1);
    // The message names the ROW it collides with, so the operator can go look
    // rather than being told a count.
    expect(out.rejected[0]?.errors[0]?.message).toMatch(/also appears on row \d+/i);
  });

  it("a parcel already on the worksheet is rejected", () => {
    const out = validate([row("123-45-678", "Travis")], [
      { apn: "123-45-678", county: "Travis", state: "TX" },
    ]);
    expect(out.valid).toHaveLength(0);
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0]?.errors[0]?.message).toMatch(/already on this worksheet/i);
  });

  it("case and spacing differences do not make it a new parcel", () => {
    // parcelRef normalises all three parts, so the old `toUpperCase()`-only
    // behaviour is preserved for the APN and EXTENDED to county and state.
    const out = validate([row("123-45-678", "Travis", "TX")], [
      { apn: " 123-45-678 ", county: "TRAVIS", state: "tx" },
    ]);
    expect(
      out.rejected,
      "a duplicate slipped through on a case or spacing difference",
    ).toHaveLength(1);
  });

  it('"Travis" and "Travis County" are the same county', () => {
    // The suffix rule lives in parcelRef; worksheets and county lists disagree
    // about which spelling they use, and both name one place.
    const out = validate([row("123-45-678", "Travis")], [
      { apn: "123-45-678", county: "Travis County", state: "TX" },
    ]);
    expect(out.rejected).toHaveLength(1);
  });
});

describe("APN punctuation is NOT collapsed", () => {
  it('"12345678" and "12-345-678" are treated as different parcels', () => {
    // Deciding two rows are duplicates DROPS one. `parcelMatchKey` would merge
    // these, and in a county where the separator is significant that discards a
    // genuinely different parcel from a tax sale — the expensive direction to
    // be wrong in. The strict `parcelKey` is used deliberately.
    const out = validate([row("12345678", "Travis"), row("12-345-678", "Travis")]);
    expect(out.rejected).toEqual([]);
    expect(out.valid).toHaveLength(2);
  });
});
