/**
 * V-Tax-1 T1 — the golden tax list, end to end (the golden-county pattern,
 * applied to tax): a SYNTHETIC sale list (shared/tax/golden/
 * tax-list-golden.csv) through the real reader, the real mapping suggestion
 * and the real validator, compared field by field to an expected output
 * written by hand (tax-list-golden.expected.json).
 *
 * What it pins: missing is null, never 0 (an amount owed the list does not
 * state is not stated, and not summed); every stated cell carries its column
 * and raw text; a blank cell in a present column is recorded as asked-and-
 * blank; an impossible date, an unreadable year and an unreadable amount
 * refuse their rows; a repeated parcel is reported, not double-imported.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertNoRowLost, parseDelimited, suggestColumnMapping, validateLotRows } from "../../server/services/taxSaleCsvImport";

const dir = path.join(__dirname, "../../shared/tax/golden");
const csv = readFileSync(path.join(dir, "tax-list-golden.csv"), "utf8");
const expected = JSON.parse(readFileSync(path.join(dir, "tax-list-golden.expected.json"), "utf8"));

describe("golden tax list", () => {
  const sheet = parseDelimited(csv);
  const suggestion = suggestColumnMapping(sheet.headers);
  const out = validateLotRows({ headers: sheet.headers, rows: sheet.rows, mapping: suggestion.mapping });

  it("the suggested mapping covers every column and leaves no required field unmapped", () => {
    expect(suggestion.mapping).toEqual(expected.mapping);
    expect(suggestion.unmappedRequired).toEqual([]);
    expect(suggestion.ignoredColumns).toEqual([]);
  });

  it("matches the hand-written expected output, row by row and field by field", () => {
    expect(out.summary).toEqual(expected.summary);
    expect(out.valid).toEqual(expected.valid);
    expect(out.rejected.map((r) => ({ fileRow: r.fileRow, fields: r.errors.map((e) => e.field) }))).toEqual(expected.rejected);
    assertNoRowLost(out);
  });

  it("each refusal names the cell and why", () => {
    const msg = (row: number) => out.rejected.find((r) => r.fileRow === row)!.errors[0];
    expect(msg(5)).toMatchObject({ column: "Sale Date", value: "2026-02-30", message: expect.stringMatching(/not a real calendar date/) });
    expect(msg(6)).toMatchObject({ column: "Tax Years", message: expect.stringMatching(/not a tax year/) });
    expect(msg(7)).toMatchObject({ column: "Amount Due", value: "call clerk" });
    expect(msg(8).message).toMatch(/also appears on row 2/);
  });

  it("a list imported into an auction takes the auction's date for a row that states none, and says so", () => {
    const headers = ["Parcel ID", "County", "State", "Sale Type", "Tax Years"];
    const m = suggestColumnMapping(headers).mapping;
    const noDate = validateLotRows({ headers, rows: [["SYNTH-T-9", "Travis", "TX", "deed", "2024"]], mapping: m });
    expect(noDate.rejected[0].errors.map((e) => e.field)).toEqual(["saleDate"]);
    const withAuction = validateLotRows({ headers, rows: [["SYNTH-T-9", "Travis", "TX", "deed", "2024"]], mapping: m, auctionSaleDate: "2026-12-01" });
    expect(withAuction.valid[0]).toMatchObject({ saleDate: "2026-12-01", saleDateSource: "auction" });
    expect(withAuction.valid[0].stated.saleDate).toBeUndefined();
  });
});
