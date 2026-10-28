/**
 * V-Notes-1 N1 — the golden note tape, end to end (the golden-county pattern,
 * applied to notes): a SYNTHETIC seller tape (shared/notes/golden/
 * note-tape-golden.csv) through the real reader, the real mapping suggestion
 * and the real validator, compared field by field to an expected output
 * written by hand from the tape (note-tape-golden.expected.json).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertNoRowLost, readNoteTape, suggestNoteTapeMapping, validateNoteTape } from "../../server/services/notes/noteTapeImport";
import { REQUIRED_NOTE_TAPE_FIELDS } from "@shared/notes/noteTapeFields";

const dir = path.join(__dirname, "../../shared/notes/golden");
const csv = readFileSync(path.join(dir, "note-tape-golden.csv"), "utf8");
const expected = JSON.parse(readFileSync(path.join(dir, "note-tape-golden.expected.json"), "utf8"));

describe("golden note tape", () => {
  const { sheet } = readNoteTape(csv);
  const { mapping, unmatchedHeaders } = suggestNoteTapeMapping(sheet.headers);
  const out = validateNoteTape({ sheet, mapping });

  it("the suggested mapping covers every column of the golden tape", () => {
    expect(unmatchedHeaders).toEqual([]);
  });

  it("matches the hand-written expected output, row by row and field by field", () => {
    expect(out.unmappedRequired).toEqual(expected.unmappedRequired);
    expect(out.summary).toEqual(expected.summary);
    // Project out provenance (`stated`) and negative knowledge (`blankMapped`) — compared separately below.
    expect(out.valid.map(({ stated: _s, blankMapped: _b, ...rest }) => rest)).toEqual(expected.valid);
    expect(out.rejected.map((r) => ({ fileRow: r.fileRow, fields: r.errors.map((e) => e.field) }))).toEqual(expected.rejected);
    assertNoRowLost(out);
  });

  it("every rejection names the field, the cell and the fix — and the blank rate is refused, never zeroed", () => {
    const rate = out.rejected.find((r) => r.fileRow === 4)!.errors[0];
    expect(rate).toMatchObject({ field: "interestRate", column: "Note Rate", value: "", fix: expect.stringMatching(/percentage/) });
    expect(rate.message).toMatch(/never filled in/);
    const date = out.rejected.find((r) => r.fileRow === 5)!.errors[0];
    expect(date).toMatchObject({ field: "originationDate", column: "Note Date", value: "2020-02-30" });
    expect(date.message).toMatch(/not a real calendar date/);
  });

  it("each stated value carries its column and raw cell; an optional field the tape leaves blank is null, not 0", () => {
    const n = out.valid[0];
    expect(n.stated.currentBalance).toEqual({ value: 8425000, source: { column: "UPB", raw: "$84,250.00", origin: "tape" } });
    expect(n.stated.balloonAmount).toBeUndefined();
    expect(n.balloonAmountCents).toBeNull();
  });
});

describe("refusal before build", () => {
  it("a tape whose required columns are unmapped is refused whole, with the fields named — no row is validated", () => {
    const { sheet } = readNoteTape("Loan #,Borrower,UPB\nX-1,SYNTHETIC,100\n");
    const out = validateNoteTape({ sheet, mapping: suggestNoteTapeMapping(sheet.headers).mapping });
    expect(out.valid).toEqual([]);
    expect(out.rejected).toEqual([]);
    expect(out.unmappedRequired.map((u) => u.field).sort()).toEqual(REQUIRED_NOTE_TAPE_FIELDS.filter((k) => !["noteNumber", "payerName", "currentBalance"].includes(k)).slice().sort());
    expect(out.unmappedRequired.map((u) => u.field)).toContain("docAssignmentChain");
  });
});

describe("targeted fix", () => {
  it("an operator correction fixes one row without touching the others, and is recorded as the operator's", () => {
    const { sheet } = readNoteTape(csv);
    const { mapping } = suggestNoteTapeMapping(sheet.headers);
    const out = validateNoteTape({ sheet, mapping, overrides: { 4: { interestRate: "7.75" } } });
    expect(out.summary).toMatchObject({ validCount: 4, rejectedCount: 1 });
    const fixed = out.valid.find((n) => n.fileRow === 4)!;
    expect(fixed.interestRateBps).toBe(775);
    expect(fixed.stated.interestRate?.source).toEqual({ column: "Note Rate", raw: "7.75", origin: "operator_correction" });
    expect(out.valid.find((n) => n.fileRow === 2)!.stated.interestRate?.source.origin).toBe("tape");
  });

  it("a document marked exception with no recorded exception is refused — an exception is recorded, never assumed", () => {
    const header = "Loan #,Borrower,Orig Balance,UPB,Note Rate,Term,P&I,Due Day,Note Date,Maturity,Purchase Date,Purchase Price,Loan Status,Original Note,Mortgage/DOT,Assignments";
    const { sheet } = readNoteTape(`${header}\nX-1,SYNTHETIC,1000,900,8,120,10,1,2020-01-01,2030-01-01,2026-09-15,500,performing,yes,yes,exception\n`);
    const out = validateNoteTape({ sheet, mapping: suggestNoteTapeMapping(sheet.headers).mapping });
    expect(out.rejected[0].errors).toEqual([expect.objectContaining({ field: "docAssignmentChain", message: expect.stringMatching(/not recorded/) })]);
  });
});

describe("golden note tape — negative knowledge", () => {
  const { sheet } = readNoteTape(csv);
  const out = validateNoteTape({ sheet, mapping: suggestNoteTapeMapping(sheet.headers).mapping });

  it("an optional column the tape has but leaves blank is recorded as asked-and-blank; a column it lacks is not", () => {
    const blanks = Object.fromEntries(out.valid.map((n) => [n.noteNumber, n.blankMapped.map((b) => `${b.field}:${b.column}`)]));
    expect(blanks["SYNTH-1001"]).toEqual(["balloonAmount:Balloon", "balloonDate:Balloon Date", "docExceptionNote:Collateral Exceptions"]);
    expect(blanks["SYNTH-1002"]).toEqual(expect.arrayContaining(["collateralApn:APN", "docAllonges:Allonges"]));
    // The golden tape has no next-due column: never asked, so never recorded as blank.
    for (const n of out.valid) expect(n.blankMapped.some((b) => b.field === "nextPaymentDate")).toBe(false);
    // A required field is never in this list — a blank required cell refuses the row instead.
    for (const n of out.valid) for (const b of n.blankMapped) expect(b.field).not.toMatch(/^(currentBalance|interestRate|maturityDate)$/);
  });
});
