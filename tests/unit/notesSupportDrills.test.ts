/**
 * Notes N9 — the support drill set, deterministic legs (drills 2 and 4).
 *
 * The N9 record (docs/evidence/2026-11-23/notes-support-drills.md) drills six
 * scenarios on the support path. Drills 1 and 3 go through the LLM resolver
 * and are staging-only (the record is their battery). Drills 5 (1099-INT,
 * DEFECT-0101) and 6 (S-1 borrower erasure) are already pinned where they
 * live: `bookkeeping1099.test.ts` (the refusal middleware, incl. fail-closed)
 * and `dsarDrill.realdb.test.ts` assertion 9 (RETENTION_REQUIRED_LOAN_RECORDS
 * against a real DB). This file pins the two legs that had no drill-shaped
 * pin — the tape-import legs a support ticket actually hits:
 *
 *   Drill 2 (stuck moment — tape import blocked): a tape whose second row
 *   carries a non-calendar origination date is refused row-exactly — the
 *   rejection names the file row, the field, the column it was read from,
 *   the offending value and the fix; the good row stays valid; and
 *   `assertNoRowLost` proves every row read is accounted for. The support
 *   path can therefore name the refusing row/reason from the preview
 *   response — it never has to claim "I fixed it".
 *
 *   Drill 4 (data-wrong — tape preview mapping): with the due-day and term
 *   columns swapped in the mapping (the classic off-by-one-column error),
 *   the preview does NOT assert the wrong number as fact — it refuses the
 *   row and the refusal names the field AND the column the value was
 *   actually read from ("Term", value "120"), so the mis-map is visible in
 *   the preview itself. The suggested mapping is also pinned correct, so
 *   the swap is provably the operator's, not the suggester's.
 *
 * Fixtures are synthetic (`SYNTHETIC Borrower …`, loan numbers `N9-*`).
 */
import { describe, expect, it } from "vitest";
import {
  assertNoRowLost,
  readNoteTape,
  suggestNoteTapeMapping,
  validateNoteTape,
} from "../../server/services/notes/noteTapeImport";

const HEADER =
  "Loan #,Borrower,Orig Balance,UPB,Note Rate,Term,P&I,Due Day,Note Date,Maturity,Purchase Date,Purchase Price,Loan Status,Original Note,Mortgage/DOT,Assignments";
const GOOD =
  "N9-A,SYNTHETIC Borrower A,50000,40000,9.5,120,650.00,1,2020-01-15,2030-01-15,2026-09-15,30000,performing,yes,yes,yes";
const BAD_DATE =
  "N9-B,SYNTHETIC Borrower B,50000,40000,9.5,120,650.00,1,2020-02-30,2030-01-15,2026-09-15,30000,performing,yes,yes,yes";

describe("N9 drill 2 — tape import blocked: the refusing row and reason are named, no row lost", () => {
  const { sheet } = readNoteTape(`${HEADER}\n${GOOD}\n${BAD_DATE}\n`);
  const { mapping } = suggestNoteTapeMapping(sheet.headers);
  const out = validateNoteTape({ sheet, mapping });

  it("accounts for every row: 1 valid + 1 rejected of 2 read, assertNoRowLost holds", () => {
    expect(out.summary).toMatchObject({ totalRows: 2, validCount: 1, rejectedCount: 1 });
    expect(() => assertNoRowLost(out)).not.toThrow();
  });

  it("the good row is untouched by the bad row's refusal", () => {
    expect(out.valid).toHaveLength(1);
    expect(out.valid[0]).toMatchObject({ fileRow: 2, noteNumber: "N9-A" });
  });

  it("the rejection names the row, field, source column, offending value and the fix", () => {
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0].fileRow).toBe(3);
    expect(out.rejected[0].errors).toEqual([
      expect.objectContaining({
        field: "originationDate",
        column: "Note Date",
        value: "2020-02-30",
        fix: expect.stringMatching(/date/),
      }),
    ]);
    expect(out.rejected[0].errors[0].message).toMatch(/not a real calendar date/);
  });
});

describe("N9 drill 4 — tape preview with due-day/term columns swapped: the mis-map is named, never asserted", () => {
  const { sheet } = readNoteTape(`${HEADER}\n${GOOD}\n`);
  const suggested = suggestNoteTapeMapping(sheet.headers).mapping;

  it("the suggested mapping is correct, so a swap is the operator's error, not the suggester's", () => {
    expect(sheet.headers[suggested.termMonths as number]).toBe("Term");
    expect(sheet.headers[suggested.paymentDueDay as number]).toBe("Due Day");
  });

  it("the swapped mapping is refused at preview, naming the field and the column actually read", () => {
    const idx = (h: string) => sheet.headers.indexOf(h);
    const swapped = { ...suggested, termMonths: idx("Due Day"), paymentDueDay: idx("Term") };
    const out = validateNoteTape({ sheet, mapping: swapped });
    expect(out.summary).toMatchObject({ totalRows: 1, validCount: 0, rejectedCount: 1 });
    expect(() => assertNoRowLost(out)).not.toThrow();
    // The term value (120) read as a due day is refused AS a due day, from
    // the "Term" column — the preview never presents 120 (or the due day 1
    // read as a term) as an asserted fact about the note.
    expect(out.rejected[0].errors).toEqual([
      expect.objectContaining({
        field: "paymentDueDay",
        column: "Term",
        value: "120",
        fix: expect.stringMatching(/day of the month/),
      }),
    ]);
    expect(out.rejected[0].errors[0].message).toMatch(/outside 1–31/);
  });

  it("under the correct mapping the same row previews with provenance: each stated value names its column", () => {
    const out = validateNoteTape({ sheet, mapping: suggested });
    expect(out.valid).toHaveLength(1);
    expect(out.valid[0].termMonths).toBe(120);
    expect(out.valid[0].stated.termMonths?.source).toMatchObject({ column: "Term", raw: "120" });
    expect(out.valid[0].paymentDueDay).toBe(1);
    expect(out.valid[0].stated.paymentDueDay?.source).toMatchObject({ column: "Due Day", raw: "1" });
  });
});
